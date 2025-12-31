// ======== 扩展自动填充功能 ========
// 页面加载时检查是否有存储的markdown文本
document.addEventListener('DOMContentLoaded', () => {
  // 检查是否在扩展环境中运行
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    // 从Chrome扩展存储中获取之前保存的Markdown文本和自动解析标志
    chrome.storage.local.get(['markdownText', 'autoParse'], (result) => {
      console.log('从storage获取的数据:', result); // 调试用
      // 如果存在存储的Markdown文本且启用了自动解析
      if (result.markdownText && result.autoParse) {
        // 获取文本输入框元素
        const textarea = document.getElementById('rawInput');
        if (textarea) {
          console.log('找到textarea，设置值'); // 调试用
          // 将存储的Markdown文本填充到输入框中
          textarea.value = result.markdownText;

          // 清空存储，避免下次打开时重复使用
          chrome.storage.local.remove(['markdownText', 'autoParse'], () => {
            console.log('已清除storage数据');
          });

          // 自动解析
          setTimeout(() => {
            handleDataInput();
            showToast('已自动填充选中内容');
          }, 500); // 延迟稍微长一点，确保DOM更新完成
        } else {
          console.error('未找到textarea元素');
        }
      }
    });
  } else {
    console.log('不在扩展环境中运行或没有chrome.storage');
  }
});

// ======== 原有的所有JavaScript函数 ========
// 存储表格的列头数据
let headers = [];
// 存储表格的数据行
let rows = [];
// 存储当前选中显示的列索引集合
let activeCols = new Set();
// 存储当前排序信息：列索引、升序/降序、排序状态
let sortInfo = { idx: -1, asc: true, state: 'none' }; // state: 'none' | 'asc' | 'desc'
// 存储提取到的SQL语句
let extractedSql = '';

// SQL生成缓存相关变量
let sqlGenerationCache = {
  lastFilterState: null,
  cachedSelectSql: '',
  cachedInsertSql: '',
  cachedDeleteSql: ''
};

// 拖拽相关变量
let dragSrcEl = null;
let columnOrder = []; // 存储列的顺序，初始为自然顺序
let dropIndicator = null; // 拖拽位置指示器

// 搜索字段选择相关变量
let currentSearchField = '全部字段'; // 当前选择的搜索字段，默认为全部字段

// 清空输入框时清空所有数据和界面
function clearAllData() {
  console.log('清空所有数据');

  // 清空全局变量
  headers = [];
  rows = [];
  activeCols = new Set();
  sortInfo = { idx: -1, asc: true, state: 'none' };
  extractedSql = '';

  // 更新统计信息
  const statEl = document.getElementById('stat');
  if (statEl) {
    statEl.textContent = '等待数据输入...';
  }

  // 清空侧边栏
  const colListDiv = document.getElementById('colList');
  if (colListDiv) {
    colListDiv.innerHTML = '';
  }

  // 清空表格
  const thead = document.getElementById('thead');
  const tbody = document.getElementById('tbody');
  if (thead) thead.innerHTML = '';
  if (tbody) tbody.innerHTML = '';

  // 清空SQL显示
  const sqlDisplay = document.getElementById('sqlDisplay');
  const noSqlMessage = document.getElementById('noSqlMessage');
  const copySqlBtn = document.getElementById('copySqlBtn');
  if (sqlDisplay) sqlDisplay.style.display = 'none';
  if (noSqlMessage) noSqlMessage.style.display = 'block';
  if (copySqlBtn) copySqlBtn.style.display = 'none';

  console.log('数据已清空');
}

// 从文本中提取SQL语句，优化处理复杂mysql命令行输出
function extractSql(text) {
  console.log('正在尝试从输入文本中提取SQL语句...');

  // 1. 清理文本，移除结果统计信息和无效行
  let cleanedText = text;

  // 移除结果统计信息
  cleanedText = cleanedText.replace(/^\s*\d+\s+rows\s+in\s+set\s+\(.*?\)\s*$/gm, '');

  // 移除所有无效的分隔线（包括以多个-开头的行）
  cleanedText = cleanedText.replace(/^\s*\-+[\s\+\-]*$/gm, '');

  // 2. 专门处理mysql命令行输出，按命令块分割
  const commandBlocks = [];
  let currentBlock = [];
  let lines = cleanedText.split('\n');

  for (const line of lines) {
    if (line.startsWith('mysql>')) {
      // 保存之前的块
      if (currentBlock.length > 0) {
        commandBlocks.push(currentBlock);
      }
      // 开始新块
      currentBlock = [line];
    } else if (line.trim().startsWith('->')) {
      // 添加到当前块
      currentBlock.push(line);
    } else if (currentBlock.length > 0) {
      // 如果当前在块内，且遇到了表格分隔线或内容，则当前块结束
      if (line.trim().startsWith('+') || line.trim().startsWith('|') || /^\s*\d+\s+rows\s+in\s+set\s+\(.*?\)\s*$/.test(line)) {
        // 这是结果部分，添加到当前块然后结束
        currentBlock.push(line);
        commandBlocks.push(currentBlock);
        currentBlock = [];
      } else {
        // 非结果内容，添加到当前块
        currentBlock.push(line);
      }
    } else {
      // 不在任何块内，可能是一些状态信息
      if (line.trim() !== '' && line.trim() !== 'Database changed' && line.trim() !== 'Bye') {
        currentBlock.push(line);
      }
    }
  }

  // 添加最后一个块
  if (currentBlock.length > 0) {
    commandBlocks.push(currentBlock);
  }

  // 处理每个命令块，提取有效SQL
  const validSqlCommands = [];

  for (const block of commandBlocks) {
    let sqlCommand = '';
    let isSqlCommand = false;

    for (const line of block) {
      if (line.startsWith('mysql>')) {
        // 提取命令部分
        const commandPart = line.replace('mysql>', '').trim();
        // 检查是否是use命令或其他非查询命令
        if (/^(use|show\s+databases|show\s+tables|describe|desc|show\s+create|show\s+processlist|show\s+status|show\s+variables|show\s+engines|show\s+plugins|show\s+character\s+set|show\s+collation)\s+/i.test(commandPart)) {
          isSqlCommand = false; // 这些命令不被记录
          break; // 跳过整个命令块
        }
        // 检查是否是查询命令
        const queryKeywords = ['SELECT', 'UPDATE', 'INSERT', 'DELETE', 'CREATE', 'ALTER', 'DROP', 'SHOW', 'DESCRIBE', 'EXPLAIN'];
        const isQueryCommand = queryKeywords.some(keyword => new RegExp(`^\s*${keyword}\s+`, 'i').test(commandPart));
        if (isQueryCommand) {
          sqlCommand = commandPart;
          isSqlCommand = true;
        } else {
          isSqlCommand = false;
          break; // 非查询命令，跳过整个块
        }
      } else if (line.trim().startsWith('->') && isSqlCommand) {
        // 续行，添加到SQL命令
        sqlCommand += '\n' + line.replace(/^\s*->\s*/, '');
      } else if (line.trim().startsWith('+') || line.trim().startsWith('|')) {
        // 表格结果部分，不添加到SQL命令
        continue;
      } else if (isSqlCommand && !/^\s*\d+\s+rows\s+in\s+set\s+\(.*?\)\s*$/.test(line) &&
        line.trim() !== 'Database changed' && line.trim() !== 'Bye') {
        // 其他内容，如果是SQL命令块的一部分则添加
        sqlCommand += '\n' + line;
      }
    }

    if (sqlCommand && isSqlCommand) {
      // 确保SQL命令不包含状态消息
      const cleanedCommand = sqlCommand
        .replace(/\n\s*Database changed\s*/g, '')
        .replace(/\n\s*Bye\s*/g, '')
        .trim();

      if (cleanedCommand) {
        validSqlCommands.push(cleanedCommand);
      }
    }
  }

  console.log('找到有效的SQL命令:', validSqlCommands);

  // 3. 如果有有效的SQL命令，返回最后一个
  if (validSqlCommands.length > 0) {
    const finalSql = validSqlCommands[validSqlCommands.length - 1].trim();
    console.log('提取SQL成功:', finalSql);
    return finalSql;
  }

  // 4. 如果没有找到mysql命令块，尝试从纯文本中提取SQL
  // 先清理文本
  let pureText = cleanedText
    .replace(/^mysql>\s*/gm, '')  // 移除mysql>提示符
    .replace(/^\s*->\s*/gm, '')   // 移除->提示符
    .replace(/^\s*[\-\+\|]+\s*$/gm, '')  // 移除分隔线
    .replace(/^\s*Database changed\s*$/gm, '')  // 移除状态消息
    .replace(/^\s*Bye\s*$/gm, '');  // 移除Bye消息

  // 查找SQL语句
  const sqlStatements = [];
  const sqlLines = [];
  const pureLines = pureText.split('\n');

  let inSqlStatement = false;
  for (const line of pureLines) {
    const trimmedLine = line.trim();

    // 检查是否是表格分隔线或内容
    if (/^\s*[|\+][\s\-+\w\d,\.\(\)]*\s*$/.test(line) && !/^\s*(SELECT|UPDATE|INSERT|DELETE|CREATE|ALTER|DROP|USE|SHOW|DESCRIBE|EXPLAIN)\s+/i.test(trimmedLine)) {
      // 这是表格内容，如果正在收集SQL，则结束当前SQL语句
      if (inSqlStatement && sqlLines.length > 0) {
        sqlStatements.push(sqlLines.join('\n').trim());
        sqlLines.length = 0; // 清空数组
        inSqlStatement = false;
      }
      continue;
    }

    // 检查是否是结果统计信息
    if (/^\s*\d+\s+rows\s+in\s+set\s+\(.*?\)\s*$/.test(trimmedLine)) {
      if (inSqlStatement && sqlLines.length > 0) {
        sqlStatements.push(sqlLines.join('\n').trim());
        sqlLines.length = 0;
        inSqlStatement = false;
      }
      continue;
    }

    // 检查是否是SQL语句
    const isSqlStatement = /\b(SELECT|UPDATE|INSERT|DELETE|CREATE|ALTER|DROP|SHOW|DESCRIBE|EXPLAIN)\b/i.test(trimmedLine);
    const isUseStatement = /^(use|show\s+databases|show\s+tables|describe|desc|show\s+create|show\s+processlist|show\s+status|show\s+variables|show\s+engines|show\s+plugins|show\s+character\s+set|show\s+collation)\b/i.test(trimmedLine);

    if (isSqlStatement && !isUseStatement) {
      sqlLines.push(line);
      inSqlStatement = true;
    } else if (inSqlStatement && trimmedLine !== '' && !/^\s*Database changed\s*$/i.test(trimmedLine) && !/^\s*Bye\s*$/i.test(trimmedLine)) {
      // 在SQL语句内的延续行
      sqlLines.push(line);
    } else if (inSqlStatement && (trimmedLine === '' || /^\s*Database changed\s*$/i.test(trimmedLine) || /^\s*Bye\s*$/i.test(trimmedLine))) {
      // SQL语句结束
      if (sqlLines.length > 0) {
        sqlStatements.push(sqlLines.join('\n').trim());
        sqlLines.length = 0;
        inSqlStatement = false;
      }
    }
  }

  // 处理最后可能剩余的SQL语句
  if (inSqlStatement && sqlLines.length > 0) {
    sqlStatements.push(sqlLines.join('\n').trim());
  }

  console.log('找到纯文本SQL语句:', sqlStatements);

  // 返回最后一个有效的SQL语句
  if (sqlStatements.length > 0) {
    const finalSql = sqlStatements[sqlStatements.length - 1];
    console.log('从纯文本提取SQL成功:', finalSql);
    return finalSql;
  }

  console.log('未识别到SQL语句');
  return '';
}

// 将多行SQL压缩成一行，去除不必要的占位符和注释
function compressSqlToSingleLine(sql) {
  if (!sql) return '';

  let compressed = sql;

  // 1. 移除mysql命令行提示符 (-> )
  compressed = compressed.replace(/^\s*->\s*/gm, '');

  // 2. 移除单行注释 (-- )
  compressed = compressed.replace(/--.*$/gm, '');

  // 3. 移除多行注释 (/* */)
  compressed = compressed.replace(/\/\*[\s\S]*?\*\//g, '');

  // 4. 移除多余的空白字符（空格、换行符、制表符等），替换为单个空格
  compressed = compressed.replace(/\s+/g, ' ');

  // 5. 移除语句末尾多余的分号
  compressed = compressed.replace(/;\s*$/, '');

  // 6. 去除首尾空白
  return compressed.trim();
}

// 简单的SQL格式化函数，保持原始大小写和正确缩进
function formatSql(sql) {
  // 确保输入是字符串
  if (!sql || typeof sql !== 'string') {
    console.error('formatSql: 输入不是字符串:', sql);
    return '';
  }

  // 1. 彻底清理SQL，移除所有mysql命令行提示符
  let cleanedSql = sql;
  cleanedSql = cleanedSql.replace(/^\s*->\s*/gm, ''); // 移除 -> 提示符
  cleanedSql = cleanedSql.replace(/^\s*mysql>\s*/gm, ''); // 移除 mysql> 提示符
  cleanedSql = cleanedSql.trim();

  // 2. 如果是空字符串，直接返回
  if (!cleanedSql) {
    return '';
  }

  // 3. 确保语句末尾有分号
  if (!cleanedSql.endsWith(';')) {
    cleanedSql += ';';
  }

  // 4. 添加基本的SQL格式化，包括缩进和换行
  return formatSqlWithIndentation(cleanedSql);
}

// 带缩进的SQL格式化函数
function formatSqlWithIndentation(sql) {
  if (!sql) return '';

  // 首先完全清理SQL，移除所有换行符和多余空格，将其变为单行
  let cleanedSql = sql.replace(/\n/g, ' ').replace(/\r/g, ' ').replace(/\s+/g, ' ').trim();

  // 定义需要换行的关键字
  const lineBreakKeywords = [
    'FROM', 'WHERE', 'GROUP BY', 'ORDER BY',
    'HAVING', 'LIMIT', 'JOIN', 'INNER JOIN', 'LEFT JOIN',
    'RIGHT JOIN', 'FULL JOIN', 'UNION', 'UNION ALL',
    'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
    'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE'
  ];

  // 在关键字前添加换行
  lineBreakKeywords.forEach(keyword => {
    const regex = new RegExp(`\\s+${keyword}\\s+`, 'gi');
    cleanedSql = cleanedSql.replace(regex, `\n${keyword} `);
  });

  // 特殊处理 AS 关键字，避免过多换行
  cleanedSql = cleanedSql.replace(/\s+AS\s+/gi, ' AS ');

  // 按行分割
  const lines = cleanedSql.split('\n');
  const formattedLines = [];

  // Helper function to split fields considering nested parentheses
  function splitFields(fieldsStr) {
    const fields = [];
    let currentField = '';
    let parenLevel = 0;
    let inQuotes = false;
    let quoteChar = null;

    for (let i = 0; i < fieldsStr.length; i++) {
      const char = fieldsStr[i];

      if (!inQuotes) {
        if (char === '(') {
          parenLevel++;
          currentField += char;
        } else if (char === ')') {
          parenLevel--;
          currentField += char;
        } else if (char === ',' && parenLevel === 0) {
          fields.push(currentField.trim());
          currentField = '';
        } else {
          currentField += char;
        }
      } else {
        currentField += char;
        if (char === quoteChar && fieldsStr[i - 1] !== '\\') {
          inQuotes = false;
          quoteChar = null;
        }
      }

      // Handle quotes
      if (!inQuotes && (char === '"' || char === "'") && fieldsStr[i - 1] !== '\\') {
        inQuotes = true;
        quoteChar = char;
        currentField += char;
      } else if (inQuotes) {
        currentField += char;
      }
    }

    if (currentField.trim() !== '') {
      fields.push(currentField.trim());
    }

    return fields;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.toUpperCase().startsWith('SELECT')) {
      // 处理 SELECT 行，分离 SELECT 和字段
      const selectMatch = line.match(/^SELECT\s+(.*)/i);
      if (selectMatch) {
        const fieldsStr = selectMatch[1].trim();
        const fieldList = splitFields(fieldsStr);

        // 添加 SELECT 关键字单独一行
        formattedLines.push('SELECT');

        // 添加每个字段，每行一个，带适当的缩进和逗号
        fieldList.forEach((field, idx) => {
          const trimmedField = field.trim();
          if (idx === fieldList.length - 1) {
            // 最后一个字段不加逗号
            formattedLines.push('  ' + trimmedField);
          } else {
            // 非最后一个字段加逗号
            formattedLines.push('  ' + trimmedField + ',');
          }
        });
      } else {
        formattedLines.push(line);
      }
    } else {
      // 处理其他行
      const upperLine = line.toUpperCase();

      if (upperLine.startsWith('FROM') ||
        upperLine.startsWith('WHERE') ||
        upperLine.startsWith('ORDER BY') ||
        upperLine.startsWith('GROUP BY') ||
        upperLine.startsWith('HAVING') ||
        upperLine.startsWith('LIMIT')) {
        formattedLines.push(line); // 与SELECT对齐，不缩进
      } else if (upperLine.includes('JOIN')) {
        formattedLines.push(line); // 与SELECT对齐，不缩进
      } else {
        // 其他情况，保持原样
        formattedLines.push(line);
      }
    }
  }

  return formattedLines.join('\n');
}

// 显示提取到的SQL
function displaySql(sql) {
  const sqlDisplay = document.getElementById('sqlDisplay');
  const noSqlMessage = document.getElementById('noSqlMessage');
  const copySqlBtn = document.getElementById('copySqlBtn');

  if (sql) {
    // 将多行SQL压缩成一行
    const compressedSql = compressSqlToSingleLine(sql);
    sqlDisplay.textContent = compressedSql;
    sqlDisplay.style.display = 'block';
    sqlDisplay.style.cursor = 'pointer';
    sqlDisplay.title = '点击查看完整SQL语句';
    noSqlMessage.style.display = 'none';
    copySqlBtn.style.display = 'inline-block';

    // 添加点击事件
    sqlDisplay.onclick = () => showSqlModal(sql);
  } else {
    sqlDisplay.style.display = 'none';
    sqlDisplay.onclick = null;
    noSqlMessage.style.display = 'block';
    copySqlBtn.style.display = 'none';
  }
}

// 显示SQL模态框
function showSqlModal(sql) {
  const sqlModalOverlay = document.getElementById('sqlOverlay');
  const sqlModalDisplay = document.getElementById('sqlModalDisplay');

  if (sqlModalOverlay && sqlModalDisplay) {
    // 格式化SQL后显示
    const formattedSql = formatSql(sql);
    sqlModalDisplay.textContent = formattedSql;
    sqlModalOverlay.style.display = 'flex';

    // 添加点击遮罩层关闭弹窗的事件
    const closeModalOnClickOutside = (e) => {
      if (e.target === sqlModalOverlay) {
        closeSqlModal();
      }
    };

    // 先移除可能存在的旧事件监听器
    sqlModalOverlay.removeEventListener('click', closeModalOnClickOutside);
    // 添加新的事件监听器
    sqlModalOverlay.addEventListener('click', closeModalOnClickOutside);
  }
}

// 关闭SQL模态框
function closeSqlModal() {
  // 直接获取模态框元素并关闭
  const sqlModalOverlay = document.getElementById('sqlOverlay');
  if (sqlModalOverlay) {
    sqlModalOverlay.style.display = 'none';
  }

  console.log('关闭SQL模态框');
}

// 复制SQL到剪贴板
function copySql() {
  if (extractedSql) {
    // 确保复制的SQL是干净的，没有箭头提示符
    const cleanSql = formatSql(extractedSql); // 使用formatSql函数清理箭头和格式化
    navigator.clipboard.writeText(cleanSql)
      .then(() => {
        console.log('SQL复制成功，显示提示');
        showToast('SQL已复制到剪贴板');
      })
      .catch(err => {
        console.error('复制SQL失败:', err);
        showToast('复制SQL失败，请重试');
      });
  }
}

// 从模态框复制SQL
function copySqlFromModal() {
  const sqlModalDisplay = document.getElementById('sqlModalDisplay');
  if (sqlModalDisplay && sqlModalDisplay.textContent) {
    navigator.clipboard.writeText(sqlModalDisplay.textContent)
      .then(() => {
        console.log('模态框SQL复制成功，显示提示');
        showToast('SQL已复制到剪贴板');
      })
      .catch(err => {
        console.error('复制SQL失败:', err);
        showToast('复制SQL失败，请重试');
      });
  }
}

// 为复制和关闭按钮添加事件监听（确保事件绑定正确）
document.addEventListener('DOMContentLoaded', () => {
  // 为关闭按钮添加事件监听
  const closeSqlBtn = document.getElementById('closeSqlModalBtn');
  if (closeSqlBtn) {
    closeSqlBtn.removeEventListener('click', closeSqlModal);
    closeSqlBtn.addEventListener('click', closeSqlModal);
    console.log('SQL关闭按钮事件绑定成功');
  }

  // 为顶部复制按钮添加事件监听
  const copySqlBtn = document.getElementById('copySqlBtn');
  if (copySqlBtn) {
    console.log('找到顶部复制按钮，添加事件监听');
    copySqlBtn.removeEventListener('click', copySql);
    copySqlBtn.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('顶部复制按钮被点击');
      copySql();
    });
    console.log('顶部复制按钮事件绑定成功');
  }

  // 为模态框复制按钮添加事件监听
  const copySqlModalBtn = document.getElementById('copySqlModalBtn');
  if (copySqlModalBtn) {
    console.log('找到模态框复制按钮，添加事件监听');
    copySqlModalBtn.removeEventListener('click', copySqlFromModal);
    copySqlModalBtn.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('模态框复制按钮被点击');
      copySqlFromModal();
    });
    console.log('模态框复制按钮事件绑定成功');
  }

  // 为生成SQL按钮添加事件监听
  const generateSqlBtn = document.getElementById('generateSqlBtn');
  if (generateSqlBtn) {
    console.log('找到生成SQL按钮，添加事件监听');
    generateSqlBtn.removeEventListener('click', openSqlGeneratorModal);
    generateSqlBtn.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('生成SQL按钮被点击');
      openSqlGeneratorModal();
    });
    console.log('生成SQL按钮事件绑定成功');
  }
});

// 切换主题模式（深色/浅色）
function toggleTheme() {
  // 获取当前主题
  const currentTheme = document.body.dataset.theme;
  // 确定新主题（在深色和浅色之间切换）
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  // 应用新主题
  document.body.dataset.theme = newTheme;

  // 保存主题选择到浏览器存储
  try {
    localStorage.setItem('tableToolTheme', newTheme);
  } catch (error) {
    console.warn('无法保存主题设置:', error);
  }

  // 添加主题切换动画
  document.body.style.opacity = '0.8';
  setTimeout(() => {
    document.body.style.opacity = '1';
  }, 150);
}

// 加载保存的主题设置
function loadSavedTheme() {
  try {
    // 从浏览器存储中获取保存的主题设置
    const savedTheme = localStorage.getItem('tableToolTheme');

    // 如果有保存的主题设置，则应用它
    if (savedTheme) {
      document.body.dataset.theme = savedTheme;
      console.log('已加载保存的主题:', savedTheme);
    } else {
      // 如果没有保存的主题设置，保持默认的深色主题
      document.body.dataset.theme = 'dark';
      console.log('使用默认深色主题');
    }
  } catch (error) {
    console.warn('无法加载主题设置，使用默认深色主题:', error);
    document.body.dataset.theme = 'dark';
  }
}

// 处理输入数据的主要函数
function handleDataInput() {
  // 获取文本输入框的内容并去除首尾空白
  const rawText = document.getElementById('rawInput').value.trim();

  console.log('处理输入，文本长度:', rawText.length);

  // 如果输入为空，清空所有数据
  if (!rawText) {
    console.log('输入为空，清空数据');
    clearAllData();
    return;
  }

  // 提取SQL语句
  extractedSql = extractSql(rawText);
  displaySql(extractedSql);

  // 使用改进的解析方法来处理包含换行符的表格
  const parsedResults = parseTableAdvanced(rawText);

  if (parsedResults.length < 1) {
    console.log('解析结果为空，显示错误');
    showToast('数据格式不正确');
    clearAllData();
    return;
  }

  // 第一行作为表头
  const parsedHeaders = parsedResults[0];
  console.log('解析得到表头:', parsedHeaders);

  // 其余行作为数据行
  const parsedRows = parsedResults.slice(1).filter(row => row.length === parsedHeaders.length && row.length > 0);
  console.log('解析得到数据行数量:', parsedRows.length, '过滤后:', parsedRows);

  // 更新全局数据并渲染
  updateGlobalDataAndRender(parsedHeaders, parsedRows);
}

// 更新全局数据并调用原有渲染函数
function updateGlobalDataAndRender(newHeaders, newRows) {
  console.log('更新全局数据，表头数:', newHeaders.length, '数据行数:', newRows.length);

  // 更新全局变量
  headers = newHeaders;
  rows = newRows;

  // 初始化列顺序，初始为自然顺序
  columnOrder = Array.from(headers.keys());

  // 重置列选择为全选
  activeCols = new Set(headers.keys());

  // 重置排序信息
  sortInfo = { idx: -1, asc: true, state: 'none' };

  // 更新统计信息
  document.getElementById('stat').textContent = `${rows.length} 行，${headers.length} 列`;

  // 调用原有渲染函数
  renderSidebar();
  renderTable();

  // 重新绑定单元格点击事件
  setTimeout(() => {
    bindCellClickEvents();
  }, 100);

  showToast(`解析成功: ${rows.length} 行，${headers.length} 列`);
}

// 改进的表格解析函数，能够处理包含换行符的单元格
function parseTableAdvanced(text) {
  console.log('开始解析表格文本，总长度:', text.length);
  const lines = text.split('\n');
  console.log('分割为', lines.length, '行');

  const result = [];

  // 首先找出所有行，包括表格行和非表格行
  const allLines = [];
  for (let j = 0; j < lines.length; j++) {
    const line = lines[j];
    const trimmed = line.trim();
    allLines.push({ index: j, line: trimmed, original: line });
  }

  console.log('总共', allLines.length, '行待处理');

  // 寻找标准的Markdown表格格式：表头 + 分隔行 + 数据行
  let headerIndex = -1;
  let separatorIndex = -1;
  let firstDataIndex = -1;

  // 先寻找表头和分隔行
  for (let i = 0; i < allLines.length - 1; i++) {
    const currentLine = allLines[i].line;
    const nextLine = allLines[i + 1].line;

    // 检查当前行是否为表格行（以|开头和结尾）
    if (currentLine.startsWith('|') && currentLine.endsWith('|')) {
      // 检查下一行是否为分隔行（包含-和|，看起来像:--|:--:|--:）
      if (nextLine.match(/^\s*\|[+\-:\s|]+\|?\s*$/) ||
        nextLine.match(/^\s*\|[\-\s:|]+\|?\s*$/) ||
        nextLine.match(/^\s*[\-\s|:]+\s*$/)) {
        // 这是一个标准的Markdown表格格式
        headerIndex = i;
        separatorIndex = i + 1;
        firstDataIndex = i + 2; // 数据从分隔行之后开始
        break;
      }
    }
  }

  let headerCells = [];

  if (headerIndex !== -1 && separatorIndex !== -1) {
    // 标准Markdown表格格式：有表头和分隔行
    headerCells = parseTableLine(allLines[headerIndex].line);
    console.log('标准格式表头解析结果:', headerCells);
  } else {
    // 非标准格式，尝试找到最合适的表头
    console.log('未找到标准Markdown表格格式，尝试寻找最可能的表头');

    // 寻找第一个表格行作为表头
    for (let i = 0; i < allLines.length; i++) {
      const line = allLines[i].line;
      if (line.startsWith('|') && line.endsWith('|') &&
        !line.match(/^\s*\|[+\-:\s|]+\|?\s*$/) &&  // 不是分隔行
        !line.match(/^\s*\|[\-\s:|]+\|?\s*$/) &&
        !line.match(/^\s*[\-\s|:]+\s*$/)) {
        headerIndex = i;
        headerCells = parseTableLine(line);
        firstDataIndex = i + 1;
        console.log('选择第', i, '行为表头，解析结果:', headerCells);
        break;
      }
    }

    if (headerCells.length === 0) {
      console.log('未找到合适的表头');
      return result;
    }
  }

  result.push(headerCells);
  console.log('确定表头，开始寻找数据行，从索引', firstDataIndex, '开始');

  // 从确定的数据行开始，重新构建可能被换行分割的行
  let i = firstDataIndex;
  while (i < allLines.length) {
    let currentLine = allLines[i].line;

    console.log(`检查行 ${i}: "${currentLine}"`);

    // 跳过空行、边框行和分隔行
    if (!currentLine ||
      (currentLine.includes('+') && !currentLine.match(/[a-zA-Z0-9]/)) ||
      currentLine.match(/^\s*\|[+\-:\s|]+\|?\s*$/) ||
      currentLine.match(/^\s*\|[\-\s:|]+\|?\s*$/) ||
      currentLine.match(/^\s*[\-\s|:]+\s*$/)) {
      console.log(`  -> 跳过: 空行、边框或分隔行`);
      i++;
      continue;
    }

    // 如果当前行是表格行（以|开头和结尾），直接解析
    if (currentLine.startsWith('|') && currentLine.endsWith('|')) {
      console.log(`  -> 识别为完整表格行`);
      let parsedCells = parseTableLine(currentLine);
      console.log(`  -> 解析出 ${parsedCells.length} 个单元格`);

      if (parsedCells.length === headerCells.length) {
        console.log(`  -> 添加数据行:`, parsedCells);
        result.push(parsedCells);
      } else {
        console.log(`  -> 跳过数据行，列数不匹配: ${parsedCells.length} vs ${headerCells.length}`);
      }
      i++;
    }
    // 如果当前行不是完整的表格行（只有开头有|，但结尾没有|），说明可能被换行分割了
    else if (currentLine.startsWith('|') && !currentLine.endsWith('|')) {
      console.log(`  -> 识别为被分割的表格行，开始合并后续行`);

      let reconstructedLine = currentLine;
      i++;

      // 继续合并后续行，直到找到以|结尾的行或遇到表格分隔线
      while (i < allLines.length) {
        const nextLine = allLines[i].line;
        console.log(`    检查合并行 ${i}: "${nextLine}"`);

        // 如果下一行以|开头，说明是新的表格行，停止合并
        if (nextLine.startsWith('|')) {
          console.log(`    -> 遇到新的表格行，停止合并`);
          break;
        }

        // 如果下一行包含表格分隔符特征，也停止合并
        if (nextLine.includes('+') && !nextLine.match(/[a-zA-Z0-9]/)) {
          console.log(`    -> 遇到边框行，停止合并`);
          break;
        }

        // 合并当前行到重构的行中
        reconstructedLine += ' ' + nextLine; // 使用空格连接，避免内容粘连
        console.log(`    -> 合并后: "${reconstructedLine}"`);
        i++;

        // 如果重构的行现在以|结尾，说明已经完整，可以解析
        if (reconstructedLine.endsWith('|')) {
          console.log(`    -> 重构的行现在完整，开始解析`);
          break;
        }
      }

      // 解析重构后的行
      if (reconstructedLine.startsWith('|') && reconstructedLine.endsWith('|')) {
        let parsedCells = parseTableLine(reconstructedLine);
        console.log(`  -> 重构行解析出 ${parsedCells.length} 个单元格`);

        if (parsedCells.length === headerCells.length) {
          console.log(`  -> 添加重构的数据行:`, parsedCells);
          result.push(parsedCells);
        } else {
          console.log(`  -> 跳过重构的数据行，列数不匹配: ${parsedCells.length} vs ${headerCells.length}`);
        }
      } else {
        console.log(`  -> 重构后的行不是完整的表格行: "${reconstructedLine}"`);
      }
    }
    // 如果当前行不是表格行，跳过
    else {
      console.log(`  -> 非表格行，跳过`);
      i++;
    }
  }

  console.log('最终解析结果:', result);
  return result;
}

// 解析表格行，能正确处理单元格内容中的|字符
function parseTableLine(line) {
  const trimmed = line.trim();
  const cells = [];

  if (!trimmed) return cells;

  // 如果行以|开头，使用更复杂的解析逻辑来处理单元格内容中的|字符
  if (trimmed.startsWith('|')) {
    // 移除首尾的|字符
    const content = trimmed.slice(1);
    let cell = '';
    let inBraces = 0; // 计数大括号，用于处理JSON等复杂内容
    let inBrackets = 0; // 计数中括号
    let inQuotes = false; // 跟踪是否在引号内
    let quoteChar = null; // 当前引号字符

    for (let i = 0; i < content.length; i++) {
      const char = content[i];

      // 检查是否是引号开始/结束
      if ((char === '\'"' || char === "'") && (i === 0 || content[i - 1] !== '\\')) {
        if (!inQuotes) {
          inQuotes = true;
          quoteChar = char;
        } else if (char === quoteChar) {
          inQuotes = false;
          quoteChar = null;
        }
      }

      // 如果不在引号内，处理大括号和中括号
      if (!inQuotes) {
        if (char === '{') inBraces++;
        else if (char === '}') inBraces--;
        else if (char === '[') inBrackets++;
        else if (char === ']') inBrackets--;
      }

      // 只有在不在引号内且不在嵌套结构中时，才检查|分隔符
      if (char === '|' && !inQuotes && inBraces === 0 && inBrackets === 0) {
        cells.push(cell.trim());
        cell = '';
      } else {
        cell += char;
      }
    }

    // 添加最后一个单元格
    if (cell !== '') {
      cells.push(cell.trim());
    }
  } else {
    // 如果不是以|开头，按原方式处理
    cells.push(...trimmed.split('|').map(c => c.trim()).filter(c => c));
  }

  return cells;
}

// 渲染侧边栏列选择列表
function renderSidebar() {
  // 获取搜索框中的查询内容
  const q = document.getElementById('colSearch').value.toLowerCase();
  // 获取列列表容器元素
  const colListDiv = document.getElementById('colList');

  if (!colListDiv) {
    console.error('未找到colList元素');
    return;
  }

  // 根据是否在搜索模式决定渲染顺序
  let renderOrder;
  if (q) {
    // 搜索模式下，显示所有匹配的列，按原始顺序
    renderOrder = headers.map((h, i) => i);
  } else {
    // 非搜索模式下，按columnOrder顺序显示
    renderOrder = [...columnOrder];
  }

  // 生成列列表的HTML
  const html = renderOrder.map(colIndex => {
    const h = headers[colIndex];
    // 如果有搜索内容且列名不包含搜索内容，则跳过
    if (q && !h.toLowerCase().includes(q)) return '';
    // 检查该列是否被选中
    const on = activeCols.has(colIndex);
    return `
      <div class="col-item" data-col-index="${colIndex}" draggable="true" style="display:flex; align-items:center; padding:10px; border-radius:10px; margin-bottom:6px; cursor:move; background:${on ? 'rgba(96, 165, 250, 0.1)' : 'transparent'}; border:1px solid ${on ? 'var(--primary)' : 'var(--border)'}; transition:all 0.2s ease;">
        <div style="width:16px; height:16px; border-radius:4px; border:2px solid ${on ? 'var(--primary)' : 'var(--border)'}; margin-right:12px; display:flex; align-items:center; justify-content:center; background:${on ? 'var(--primary)' : 'transparent'}; transition:all 0.2s ease;">
          ${on ? '✓' : ''}
        </div>
        <span style="font-size:13px; color:${on ? 'var(--primary)' : 'var(--text)'}; flex-grow:1; font-weight:${on ? '600' : '400'}">${h}</span>
        <div class="drag-handle" style="margin-left:10px; opacity:0.5; cursor:move;">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 5C3 4.44772 3.44772 4 4 4C4.55228 4 5 4.44772 5 5C5 5.55228 4.55228 6 4 6C3.44772 6 3 5.55228 3 5Z" fill="currentColor"/>
            <path d="M3 9C3 8.44772 3.44772 8 4 8C4.55228 8 5 8.44772 5 9C5 9.55228 4.55228 10 4 10C3.44772 10 3 9.55228 3 9Z" fill="currentColor"/>
            <path d="M3 13C3 12.4477 3.44772 12 4 12C4.55228 12 5 12.4477 5 13C5 13.5523 4.55228 14 4 14C3.44772 14 3 13.5523 3 13Z" fill="currentColor"/>
            <path d="M8 5C8 4.44772 8.44772 4 9 4C9.55228 4 10 4.44772 10 5C10 5.55228 9.55228 6 9 6C8.44772 6 8 5.55228 8 5Z" fill="currentColor"/>
            <path d="M8 9C8 8.44772 8.44772 8 9 8C9.55228 8 10 8.44772 10 9C10 9.55228 9.55228 10 9 10C8.44772 10 8 9.55228 8 9Z" fill="currentColor"/>
            <path d="M8 13C8 12.4477 8.44772 12 9 12C9.55228 12 10 12.4477 10 13C10 13.5523 9.55228 14 9 14C8.44772 14 8 13.5523 8 13Z" fill="currentColor"/>
            <path d="M13 5C13 4.44772 13.4477 4 14 4C14.5523 4 15 4.44772 15 5C15 5.55228 14.5523 6 14 6C13.4477 6 13 5.55228 13 5Z" fill="currentColor"/>
            <path d="M13 9C13 8.44772 13.4477 8 14 8C14.5523 8 15 8.44772 15 9C15 9.55228 14.5523 10 14 10C13.4477 10 13 9.55228 13 9Z" fill="currentColor"/>
            <path d="M13 13C13 12.4477 13.4477 12 14 12C14.5523 12 15 12.4477 15 13C15 13.5523 14.5523 14 14 14C13.4477 14 13 13.5523 13 13Z" fill="currentColor"/>
          </svg>
        </div>
      </div>
    `;
  }).filter(item => item !== '').join(''); // 过滤掉空字符串

  colListDiv.innerHTML = html;

  // 绑定列选择事件
  const colItems = colListDiv.querySelectorAll('.col-item');
  colItems.forEach(item => {
    const colIndex = parseInt(item.getAttribute('data-col-index'));

    // 添加拖拽事件监听器
    item.addEventListener('dragstart', handleDragStart);
    item.addEventListener('dragover', handleDragOver);
    item.addEventListener('dragenter', handleDragEnter);
    item.addEventListener('dragleave', handleDragLeave);
    item.addEventListener('drop', handleDrop);
    item.addEventListener('dragend', handleDragEnd);

    // 保持原有的点击事件
    item.addEventListener('click', (e) => {
      // 如果点击的是拖拽手柄，则不触发列选择
      if (!e.target.classList.contains('drag-handle')) {
        toggleCol(colIndex);
      }
    });
  });
}

// 拖拽事件处理函数
function handleDragStart(e) {
  dragSrcEl = e.target;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/html', e.target.innerHTML);
}

function handleDragOver(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  e.dataTransfer.dropEffect = 'move';

  // 计算插入位置并显示指示器
  if (dragSrcEl) {
    const destElement = e.target.closest('.col-item');
    if (destElement && destElement !== dragSrcEl) {
      // 计算插入位置
      const rect = destElement.getBoundingClientRect();
      const offsetY = e.clientY - rect.top;
      const height = rect.height;
      const isBottomHalf = offsetY > height / 2;

      // 创建或更新指示器
      if (!dropIndicator) {
        dropIndicator = document.createElement('div');
        dropIndicator.className = 'drop-indicator';
      }

      // 确定指示器位置
      const container = destElement.parentElement;
      if (isBottomHalf) {
        // 插入到目标元素之后
        const nextSibling = destElement.nextSibling;
        if (nextSibling) {
          container.insertBefore(dropIndicator, nextSibling);
        } else {
          container.appendChild(dropIndicator);
        }
      } else {
        // 插入到目标元素之前
        container.insertBefore(dropIndicator, destElement);
      }
    }
  }

  return false;
}

function handleDragEnter(e) {
  this.classList.add('drag-over');
}

function handleDragLeave(e) {
  this.classList.remove('drag-over');

  // 移除拖拽指示器（但不是在每次离开子元素时都移除，只有在真正离开容器时才移除）
  if (dropIndicator && dropIndicator.parentElement) {
    const relatedTarget = e.relatedTarget;
    if (!relatedTarget || !this.contains(relatedTarget)) {
      dropIndicator.parentElement.removeChild(dropIndicator);
      dropIndicator = null;
    }
  }
}

function handleDrop(e) {
  if (e.stopPropagation) {
    e.stopPropagation();
  }

  // 找到最近的col-item元素作为目标
  const destElement = e.target.closest('.col-item');
  if (dragSrcEl !== destElement && destElement) {
    // 获取源列和目标列的索引
    const srcIndex = parseInt(dragSrcEl.getAttribute('data-col-index'));
    const destIndex = parseInt(destElement.getAttribute('data-col-index'));

    if (!isNaN(srcIndex) && !isNaN(destIndex) && srcIndex !== destIndex) {
      // 只在非搜索模式下进行排序
      const q = document.getElementById('colSearch').value.toLowerCase();
      if (!q) {
        // 在非搜索模式下，用户看到的顺序就是columnOrder的顺序
        // 所以我们需要找到这两个列在columnOrder中的位置
        const srcOrderIndex = columnOrder.indexOf(srcIndex);
        const destOrderIndex = columnOrder.indexOf(destIndex);

        if (srcOrderIndex !== -1 && destOrderIndex !== -1) {
          // 计算实际插入位置 - 根据dropIndicator的位置
          let insertIndex = destOrderIndex;
          if (dropIndicator) {
            // 获取dropIndicator在容器中的位置来确定插入索引
            const container = destElement.parentElement;
            const allItems = Array.from(container.children);
            insertIndex = allItems.indexOf(dropIndicator);

            // 由于侧边栏现在是按照columnOrder渲染的，我们需要将insertIndex转换为columnOrder中的索引
            // 获取dropIndicator前一个元素的data-col-index
            const prevElement = dropIndicator.previousElementSibling;
            if (prevElement && prevElement.classList.contains('col-item')) {
              const prevColIndex = parseInt(prevElement.getAttribute('data-col-index'));
              const prevOrderIndex = columnOrder.indexOf(prevColIndex);
              if (prevOrderIndex !== -1) {
                insertIndex = prevOrderIndex + 1;
              }
            } else {
              // 如果dropIndicator是第一个元素，或前面没有col-item，则插入到开头
              const nextElement = dropIndicator.nextElementSibling;
              if (nextElement && nextElement.classList.contains('col-item')) {
                const nextColIndex = parseInt(nextElement.getAttribute('data-col-index'));
                const nextOrderIndex = columnOrder.indexOf(nextColIndex);
                if (nextOrderIndex !== -1) {
                  insertIndex = nextOrderIndex;
                }
              }
            }
          }

          if (insertIndex < 0) insertIndex = 0;
          if (insertIndex > columnOrder.length) insertIndex = columnOrder.length;

          // 创建新的数组来避免索引问题
          const newColumnOrder = [...columnOrder];
          // 从原位置移除元素
          const [movedItem] = newColumnOrder.splice(srcOrderIndex, 1);

          // 调整插入索引，因为移除元素后索引可能发生变化
          const adjustedInsertIndex = insertIndex > srcOrderIndex ? insertIndex - 1 : insertIndex;

          // 在目标位置插入元素
          newColumnOrder.splice(adjustedInsertIndex, 0, movedItem);

          // 更新全局columnOrder数组
          columnOrder = newColumnOrder;

          // 重新渲染侧边栏和表格以反映列的新顺序
          renderSidebar();
          renderTable();
        }
      } else {
        // 搜索模式下不进行排序，只更新表格显示
        renderTable();
      }
    }
  }

  // 移除拖拽指示器
  if (dropIndicator && dropIndicator.parentElement) {
    dropIndicator.parentElement.removeChild(dropIndicator);
    dropIndicator = null;
  }

  return false;
}

function handleDragEnd(e) {
  const items = document.querySelectorAll('.col-item.drag-over');
  items.forEach(item => {
    item.classList.remove('drag-over');
  });

  // 移除拖拽指示器
  if (dropIndicator && dropIndicator.parentElement) {
    dropIndicator.parentElement.removeChild(dropIndicator);
    dropIndicator = null;
  }

  dragSrcEl = null;
}

// 设置所有列的显示或隐藏状态
function setCols(show) {
  // 如果show为true，则选中所有列；否则清空选中状态
  activeCols = show ? new Set(headers.keys()) : new Set();
  renderSidebar();
  renderTable();
  showToast(show ? '已全选所有列' : '已清空所有列选择');
}

// 切换指定列的显示/隐藏状态
function toggleCol(i) {
  // 如果该列已被选中，则取消选中；否则选中该列
  if (activeCols.has(i)) activeCols.delete(i);
  else activeCols.add(i);
  renderSidebar();
  renderTable();
}

// 对HTML属性进行转义，防止XSS攻击
function htmlEscapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 渲染主表格
function renderTable() {
  // 更新字段下拉菜单选项
  updateFieldDropdown();

  // 获取行搜索框的查询内容
  const q = document.getElementById('rowSearch').value.toLowerCase();
  // 获取当前激活的列索引数组并根据 columnOrder 排序
  const activeIdxs = Array.from(activeCols).sort((a, b) => {
    const aOrder = columnOrder.indexOf(a);
    const bOrder = columnOrder.indexOf(b);
    return aOrder - bOrder;
  });

  // 获取表头元素
  const thead = document.getElementById('thead');
  const tbody = document.getElementById('tbody');

  // 如果没有任何列被选中，显示提示并清空表格
  if (activeIdxs.length === 0) {
    // 清空表头
    if (thead) thead.innerHTML = '';

    // 清空表格主体并显示提示
    if (tbody) {
      tbody.innerHTML = `<tr><td style="text-align:center; color:var(--text-secondary); padding:40px; font-size:14px;">没有列被选中，请在侧边栏选择要显示的列</td></tr>`;
    }

    // 更新统计信息
    const statEl = document.getElementById('stat');
    if (statEl) {
      statEl.textContent = headers.length > 0 ? `${rows.length} 行，0 列（无选中）` : '等待数据输入...';
    }

    // 清空所有单元格点击事件绑定
    const cells = document.querySelectorAll('td');
    cells.forEach(cell => {
      cell.onclick = null;
    });

    return; // 直接返回，不再执行后面的渲染逻辑
  }

  // 生成表头HTML
  let theadHTML = `<tr>${activeIdxs.map(i => {
    const isSorted = sortInfo.idx === i;
    const sortClass = isSorted ? (sortInfo.state === 'asc' ? 'sort-asc' : 'sort-desc') : '';
    // 根据排序状态显示不同箭头：无排序(↕) -> 升序(▴) -> 降序(▾) -> 无排序(↕)
    const arrow = isSorted ? (sortInfo.state === 'asc' ? ' ▴' : sortInfo.state === 'desc' ? ' ▾' : ' ↕') : ' ↕';
    // 根据排序状态设置复制按钮颜色
    const copyBtnColor = isSorted ? (sortInfo.state === 'asc' ? 'var(--primary)' : 'var(--accent)') : 'var(--text)';
    return `
          <th class="${sortClass}" data-sort-index="${i}">
            <div style="display: flex; align-items: center;">
              <span style="flex: 1;">${headers[i]}</span>
              <button class="copy-header-btn" data-header="${headers[i]}" style="margin-left: 4px; border: none; background: none; cursor: pointer; opacity: 0.5; padding: 2px; width: 16px; height: 16px;" title="复制字段">
                <svg t="1766736293870" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
                  <path d="M890.197333 41.984H347.178667C296.832 41.984 256 81.194667 256 129.536v75.861333h86.016V156.928c0-16.128 13.610667-29.184 30.378667-29.184h492.16c16.768 0 30.378667 13.056 30.378666 29.184v539.349333c0 7.68-3.2 15.061333-8.96 20.437334a30.378667 30.378667 0 0 1-21.461333 8.149333H733.866667v85.12h156.245333c50.133333 0 90.88-38.826667 91.178667-86.954667V129.536C981.333333 81.194667 940.501333 41.984 890.197333 41.984z" fill="${copyBtnColor}" p-id="5425"></path>
                  <path d="M676.864 214.016H133.845333C83.498667 214.016 42.666667 253.226667 42.666667 301.568v75.861333h86.016V328.96c0-16.128 13.610667-29.184 30.378666-29.184h492.16c16.768 0 30.378667 13.056 30.378667 29.184v539.349333c0 7.68-3.2 15.061333-8.96 20.437334a30.378667 30.378667 0 0 1-21.461333 8.149333H520.533333v85.12h156.245334c50.133333 0 90.88-38.826667 91.178666-86.954667V301.568c0.042667-48.341333-40.789333-87.552-91.093333-87.552z" fill="${copyBtnColor}" p-id="5426"></path>
                  <path d="M42.709333 301.568v593.493333c0.298667 48.128 41.045333 86.954667 91.178667 86.954667H546.133333v-85.12H159.445333a30.378667 30.378667 0 0 1-21.461333-8.149333 27.946667 27.946667 0 0 1-8.96-20.437334V328.96c0-16.128 13.610667-29.184 30.378667-29.184h492.16c16.768 0 30.378667 13.056 30.378666 29.184v48.469333H768V301.568c0-48.341333-40.832-87.552-91.178667-87.552H133.802667c-50.304 0-91.136 39.210667-91.093334 87.552z" fill="${copyBtnColor}" p-id="5427"></path>
                  <path d="M256 384.682667h298.666667a42.666667 42.666667 0 0 1 0 85.333333H256a42.666667 42.666667 0 0 1 0-85.333333zM256 555.349333h298.666667a42.666667 42.666667 0 0 1 0 85.333334H256a42.666667 42.666667 0 0 1 0-85.333334zM256 726.016h298.666667a42.666667 42.666667 0 0 1 0 85.333333H256a42.666667 42.666667 0 0 1 0-85.333333z" fill="${copyBtnColor}" p-id="5428"></path>
                </svg>
              </button>
              <span style="margin-left: 4px;">${arrow}</span>
            </div>
          </th>
        `;
  }).join('')}</tr>`;

  if (thead) thead.innerHTML = theadHTML;

  // 绑定表头排序事件
  const thElements = document.querySelectorAll('th[data-sort-index]');
  thElements.forEach(th => {
    const sortIndex = parseInt(th.getAttribute('data-sort-index'));
    th.addEventListener('click', () => applySort(sortIndex));
  });

  // 绑定表头复制按钮事件
  const copyHeaderBtns = document.querySelectorAll('.copy-header-btn');
  copyHeaderBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // 阻止事件冒泡，避免触发排序
      const headerValue = btn.getAttribute('data-header');
      navigator.clipboard.writeText(headerValue).then(() => {
        showToast('字段已复制');
      }).catch(err => {
        console.error('复制失败: ', err);
      });
    });

    // 鼠标悬停效果
    btn.addEventListener('mouseenter', () => {
      btn.style.opacity = '1';
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.opacity = '0.5';
    });
  });

  // 过滤行
  let filteredRows = rows.filter(r => {
    if (!q) return true;

    if (currentSearchField === '全部字段') {
      // 在所有激活列中搜索
      return r.some((cell, idx) => {
        // 只检查活跃列
        if (!activeCols.has(idx)) return false;
        const cellText = cell ? String(cell).toLowerCase() : '';
        return cellText.includes(q);
      });
    } else {
      // 只在选定字段中搜索
      const fieldIndex = headers.indexOf(currentSearchField);
      // 检查字段是否存在且在激活列中
      if (fieldIndex === -1 || !activeCols.has(fieldIndex)) return false;
      const cellText = r[fieldIndex] ? String(r[fieldIndex]).toLowerCase() : '';
      return cellText.includes(q);
    }
  });

  // 应用排序
  if (sortInfo.idx >= 0 && activeCols.has(sortInfo.idx) && sortInfo.state !== 'none') {
    filteredRows.sort((a, b) => {
      const aVal = a[sortInfo.idx];
      const bVal = b[sortInfo.idx];
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortInfo.asc ? cmp : -cmp;
    });
  }

  // 生成表格行
  let tbodyHTML = filteredRows.map((r, ri) => `
    <tr>
      ${activeIdxs.map(i => {
    let cell = r[i];
    let displayText = cell === null || cell === undefined ? '' : String(cell);
    let cellContent = displayText;

    // 处理JSON数据
    if (cell && typeof cell === 'string' && (cell.startsWith('{') || cell.startsWith('['))) {
      try {
        const jsonObj = JSON.parse(cell);
        cellContent = `
              <span class="json-badge" title="点击查看完整JSON">JSON</span>
              ${JSON.stringify(jsonObj).substring(0, 50)}${JSON.stringify(jsonObj).length > 50 ? '...' : ''}
            `;
        return `<td class="table-cell" data-col-index="${i}" data-json="${htmlEscapeAttr(cell)}" style="position:relative;">${cellContent}</td>`;
      } catch (e) {
        // 不是有效JSON，按普通文本处理
      }
    }

    // 普通文本
    return `<td class="table-cell" data-col-index="${i}" style="position:relative;">
          <span style="display:block; width:100%; height:100%;">${escapeHtml(displayText)}</span>
        </td>`;
  }).join('')}
    </tr>
  `).join('');

  if (tbody) tbody.innerHTML = tbodyHTML;

  // 更新统计信息
  const statEl = document.getElementById('stat');
  if (statEl) {
    const totalRows = rows.length;
    const filteredCount = filteredRows.length;
    const colCount = activeIdxs.length;
    statEl.textContent = filteredCount === totalRows
      ? `${totalRows} 行，${colCount} 列`
      : `${filteredCount}/${totalRows} 行，${colCount} 列`;
  }

  // 重新绑定单元格点击事件
  bindCellClickEvents();
}

// 更新字段下拉菜单选项
function updateFieldDropdown() {
  const fieldDropdown = document.getElementById('fieldDropdown');
  if (!fieldDropdown) return;

  // 清空现有内容
  fieldDropdown.innerHTML = `
    <input type="text" id="fieldSearchInput" class="field-search-input" placeholder="搜索字段..." />
    <div id="fieldOptionsContainer" class="field-options-container">
      <div class="field-option" data-field="全部字段">全部字段</div>
    </div>
  `;

  // 添加激活的字段选项
  const fieldOptionsContainer = document.getElementById('fieldOptionsContainer');
  for (const idx of activeCols) {
    const header = headers[idx];
    if (header) {
      const option = document.createElement('div');
      option.className = 'field-option';
      option.setAttribute('data-field', header);
      option.textContent = header;
      fieldOptionsContainer.appendChild(option);
    }
  }

  // 绑定搜索输入框事件
  const fieldSearchInput = document.getElementById('fieldSearchInput');
  if (fieldSearchInput) {
    fieldSearchInput.addEventListener('input', filterFieldOptions);
  }
}

// 过滤字段选项
function filterFieldOptions() {
  const searchInput = document.getElementById('fieldSearchInput');
  const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
  const optionsContainer = document.getElementById('fieldOptionsContainer');
  const options = optionsContainer ? optionsContainer.querySelectorAll('.field-option') : [];

  options.forEach(option => {
    const fieldText = option.textContent.toLowerCase();
    if (fieldText.includes(searchTerm)) {
      option.style.display = 'flex'; // 显示匹配的选项
    } else {
      option.style.display = 'none'; // 隐藏不匹配的选项
    }
  });
}


// 绑定单元格点击事件
function bindCellClickEvents() {
  const tbody = document.getElementById('tbody');
  if (!tbody) return;

  // 移除之前的事件监听器，避免重复绑定
  tbody.removeEventListener('click', handleCellClick);
  tbody.removeEventListener('mousedown', handleMouseDown);

  // 添加新的事件监听器
  tbody.addEventListener('click', handleCellClick);
  tbody.addEventListener('mousedown', handleMouseDown);

  // 多选功能相关变量
  let selectedCells = new Set(); // 使用Set来存储选中的单元格，避免重复

  // 处理单元格点击事件的内部函数
  function handleCellClick(e) {
    const cell = e.target.closest('td');
    if (!cell) return;

    // 检查是否按下了Ctrl键或Shift键来选择多个单元格
    if (e.ctrlKey || e.shiftKey) {
      // 如果按住Ctrl或Shift键，进行多选操作
      e.preventDefault(); // 阻止默认行为

      // 切换单元格选中状态
      if (selectedCells.has(cell)) {
        // 如果已选中，则取消选中
        cell.classList.remove('selected');
        selectedCells.delete(cell);
      } else {
        // 如果未选中，则选中
        cell.classList.add('selected');
        selectedCells.add(cell);
      }

      // 如果有选中的单元格，复制它们的内容
      if (selectedCells.size > 0) {
        copySelectedCells();
      }

      return;
    }

    // 如果没有按Ctrl或Shift键，检查是否点击了非选中的单元格
    if (!selectedCells.has(cell)) {
      // 如果点击的是非选中的单元格，清除之前的选中状态
      clearAllSelections();
    }

    // 如果是JSON单元格
    if (cell.hasAttribute('data-json')) {
      // 检查点击的是否是JSON徽章
      if (e.target.classList.contains('json-badge')) {
        showJsonModalFromAttr(cell);
      } else {
        // 点击JSON单元格其他部分也显示模态框
        showJsonModalFromAttr(cell);
      }
    } else {
      // 普通单元格复制
      copyCellContent(cell);
    }
  }

  // 处理鼠标按下事件
  function handleMouseDown(e) {
    const cell = e.target.closest('td');
    if (!cell) return;

    // 如果按下了Ctrl或Shift键，准备进行多选
    if (e.ctrlKey || e.shiftKey) {
      e.preventDefault(); // 阻止默认行为，防止全选
    }
  }

  // 清除所有选中状态
  function clearAllSelections() {
    selectedCells.forEach(cell => {
      cell.classList.remove('selected');
    });
    selectedCells.clear();
  }

  // 复制选中单元格的内容
  function copySelectedCells() {
    if (selectedCells.size === 0) return;

    // 按行和列组织选中的单元格，以便保持表格结构
    const rows = new Map();
    for (const cell of selectedCells) {
      const tr = cell.closest('tr');
      const rowIndex = Array.from(tbody.querySelectorAll('tr')).indexOf(tr);
      const colIndex = parseInt(cell.getAttribute('data-col-index'));

      if (!rows.has(rowIndex)) {
        rows.set(rowIndex, new Map());
      }
      rows.get(rowIndex).set(colIndex, cell);
    }

    // 按顺序获取内容并组织成表格格式
    const sortedRowIndices = Array.from(rows.keys()).sort((a, b) => a - b);
    let content = '';

    sortedRowIndices.forEach((rowIndex, i) => {
      const cols = rows.get(rowIndex);
      const sortedColIndices = Array.from(cols.keys()).sort((a, b) => a - b);

      let rowContent = '';
      sortedColIndices.forEach((colIndex, j) => {
        if (j > 0) rowContent += '\t'; // 使用制表符分隔列
        const cell = cols.get(colIndex);

        // 检查是否为JSON单元格
        if (cell.hasAttribute('data-json')) {
          // 对于JSON单元格，获取存储的JSON值
          rowContent += cell.getAttribute('data-json').replace(/\n/g, ' ');
        } else {
          // 对于普通单元格，获取显示的内容
          const span = cell.querySelector('span');
          if (span) {
            rowContent += (span.textContent || span.innerText).replace(/\n/g, ' ');
          } else {
            rowContent += (cell.textContent || cell.innerText).replace(/\n/g, ' ');
          }
        }
      });

      if (i > 0) content += '\n'; // 使用换行符分隔行
      content += rowContent;
    });

    // 创建临时textarea来复制选中单元格的内容
    const tempTextArea = document.createElement('textarea');
    tempTextArea.value = content;
    tempTextArea.style.cssText = 'position: absolute; left: -9999px; opacity: 0;';
    document.body.appendChild(tempTextArea);
    tempTextArea.select();
    document.execCommand('copy');
    document.body.removeChild(tempTextArea);

    const cellCount = selectedCells.size;
    showToast(`已复制 ${cellCount} 个单元格的内容`);
  }

  // 添加全局点击事件监听器，用于取消多选状态
  document.addEventListener('click', (e) => {
    // 检查点击的是否是表格内的单元格
    const cell = e.target.closest('td');

    // 如果点击的不是表格单元格，或者没有按Ctrl/Shift键，则清除选择
    if (!cell && selectedCells.size > 0) {
      clearAllSelections();
    } else if (cell && !e.ctrlKey && !e.shiftKey && !selectedCells.has(cell)) {
      // 如果点击了表格中的单元格，但没有按Ctrl/Shift键，且不是之前选中的单元格，则清除选择
      clearAllSelections();
    }
  });

  // 为已有的单元格添加样式指示
  const cells = tbody.querySelectorAll('td');
  cells.forEach(cell => {
    if (!cell.hasAttribute('data-json')) {
      cell.style.cursor = 'pointer';
      cell.title = '点击复制单元格，按住Ctrl/Shift键可多选单元格';
    } else {
      cell.style.cursor = 'pointer';
      cell.title = '点击查看JSON详情，按住Ctrl/Shift键可多选单元格';
    }
  });
}

// 复制单元格内容到剪贴板
function copyCellContent(cell) {
  let text = '';
  const badge = cell.querySelector('.json-badge');

  if (badge) {
    // 对于JSON单元格，获取原始JSON文本
    text = cell.getAttribute('data-json') || cell.textContent.replace('JSON', '').trim();
  } else {
    text = cell.textContent.trim();
  }

  // 使用Clipboard API复制文本
  navigator.clipboard.writeText(text)
    .then(() => {
      showToast('内容已复制');

      // 添加复制反馈效果
      const indicator = cell.querySelector('.copy-indicator');
      if (indicator) {
        indicator.style.display = 'block';
        setTimeout(() => {
          indicator.style.display = 'none';
        }, 1000);
      }

      // 单元格高亮效果
      cell.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
      setTimeout(() => {
        cell.style.backgroundColor = '';
      }, 300);
    })
    .catch(err => {
      console.error('复制失败:', err);
      showToast('复制失败，请重试');
    });
}

// 应用排序到指定列
function applySort(i) {
  // 如果点击的是当前已排序的列
  if (sortInfo.idx === i) {
    // 同一列点击：none -> asc -> desc -> none
    if (sortInfo.state === 'none') {
      sortInfo.state = 'asc';
      sortInfo.asc = true;
    } else if (sortInfo.state === 'asc') {
      sortInfo.state = 'desc';
      sortInfo.asc = false;
    } else if (sortInfo.state === 'desc') {
      sortInfo.state = 'none';
      sortInfo.idx = -1;
    }
  } else {
    // 点击不同列：重置为升序
    sortInfo.idx = i;
    sortInfo.state = 'asc';
    sortInfo.asc = true;
  }
  renderTable();
}

// 从属性显示JSON模态框
function showJsonModalFromAttr(td) {
  // 获取存储在data-json属性中的JSON字符串
  const val = td.getAttribute('data-json');
  try {
    // 解析JSON字符串为对象
    const obj = JSON.parse(val);
    // 格式化并高亮显示JSON内容
    const formattedJson = syntaxHighlight(JSON.stringify(obj, null, 2));
    // 将格式化后的JSON显示在模态框中
    document.getElementById('jsonDisplay').innerHTML = formattedJson;
    // 显示JSON模态框
    document.getElementById('jsonOverlay').style.display = 'flex';
  } catch (e) {
    alert("解析 JSON 失败，可能不是标准 JSON 格式");
  }
}

// 为JSON字符串添加语法高亮
function syntaxHighlight(json) {
  // 转义HTML特殊字符
  json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // 使用正则表达式匹配不同类型的JSON元素并添加相应的CSS类
  return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
    let cls = 'json-number';
    if (/^"/.test(match)) {
      if (/:$/.test(match)) {
        cls = 'json-key';
      } else {
        cls = 'json-string';
      }
    } else if (/true|false/.test(match)) {
      cls = 'json-boolean';
    } else if (/null/.test(match)) {
      cls = 'json-null';
    }
    return '<span class="' + cls + '">' + match + '</span>';
  });
}

// 关闭JSON模态框
function closeModal() {
  document.getElementById('jsonOverlay').style.display = 'none';
}

// 复制模态框中的JSON内容
function copyJsonInModal() {
  // 获取JSON显示区域的文本内容
  const text = document.getElementById('jsonDisplay').textContent;
  // 复制到剪贴板
  navigator.clipboard.writeText(text);
  showToast("JSON 已复制");
}

// 显示提示消息
function showToast(msg) {
  // 获取提示元素
  const t = document.getElementById('toast');
  // 设置提示消息内容
  t.innerText = msg;
  // 显示提示
  t.style.display = 'block';
  // 1.5秒后自动隐藏提示
  setTimeout(() => t.style.display = 'none', 1500);
}



// 显示版本信息模态框
function showVersion() {
  // 关闭所有可能打开的下拉菜单，避免它们显示在版本弹窗之上
  const fieldSelector = document.getElementById('fieldSelector');
  const fieldDropdown = document.getElementById('fieldDropdown');
  if (fieldSelector) {
    fieldSelector.classList.remove('open');
  }
  if (fieldDropdown) {
    fieldDropdown.classList.remove('show');
  }

  document.getElementById('versionOverlay').style.display = 'flex';

  // 确保版本弹窗的遮罩层在所有其他元素之上
  const versionOverlay = document.getElementById('versionOverlay');
  if (versionOverlay) {
    versionOverlay.style.zIndex = '99999';
  }
}

// 关闭版本信息模态框
function closeVersionModal() {
  document.getElementById('versionOverlay').style.display = 'none';

  // 恢复版本弹窗遮罩层的原始z-index
  const versionOverlay = document.getElementById('versionOverlay');
  if (versionOverlay) {
    versionOverlay.style.zIndex = ''; // 恢复为CSS中定义的默认值
  }
}



// 初始绑定单元格点击事件
document.addEventListener('DOMContentLoaded', bindCellClickEvents);

// 暴露函数到全局作用域，以便HTML中的onclick调用
window.toggleTheme = toggleTheme;
window.handleDataInput = handleDataInput;
window.setCols = setCols;
window.toggleCol = toggleCol;
window.applySort = applySort;
window.showVersion = showVersion;
window.closeVersionModal = closeVersionModal;
window.closeModal = closeModal;
window.copyJsonInModal = copyJsonInModal;

// ======== 事件绑定 ========
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM已加载，开始绑定事件');

  // 加载用户上次选择的主题，如果没有则使用默认的深色主题
  loadSavedTheme();

  // 绑定主题切换按钮
  const toggleThemeBtn = document.getElementById('toggleThemeBtn');
  if (toggleThemeBtn) {
    toggleThemeBtn.addEventListener('click', toggleTheme);
    console.log('主题切换按钮已绑定');
  }

  // 绑定列选择按钮 - 正确功能：控制表头选择
  const selectAllBtn = document.getElementById('selectAllBtn');
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => setCols(true));
    console.log('全选按钮已绑定');
  }

  const clearAllBtn = document.getElementById('clearAllBtn');
  if (clearAllBtn) {
    // 正确功能：清空所有表头选择（取消选择所有列）
    clearAllBtn.addEventListener('click', () => setCols(false));
    console.log('清空按钮已绑定');
  }

  // 绑定列搜索输入框
  const colSearchInput = document.getElementById('colSearch');
  if (colSearchInput) {
    colSearchInput.addEventListener('input', () => {
      console.log('列搜索输入变化');
      renderSidebar();
    });
    console.log('列搜索输入框已绑定');
  }

  // 绑定主文本输入框
  const rawInput = document.getElementById('rawInput');
  if (rawInput) {
    // 使用 input 事件实时处理
    rawInput.addEventListener('input', () => {
      console.log('主文本输入变化');
      handleDataInput();
    });

    // 添加粘贴事件处理
    rawInput.addEventListener('paste', (e) => {
      // 粘贴后稍等片刻再处理，确保文本已插入
      setTimeout(() => {
        handleDataInput();
      }, 10);
    });

    console.log('主文本输入框已绑定');
  }

  // 绑定行搜索输入框
  const rowSearchInput = document.getElementById('rowSearch');
  if (rowSearchInput) {
    rowSearchInput.addEventListener('input', () => {
      console.log('行搜索输入变化');
      renderTable();
    });
    console.log('行搜索输入框已绑定');
  }

  // 绑定字段选择器
  const fieldSelector = document.getElementById('fieldSelector');
  const fieldDropdown = document.getElementById('fieldDropdown');
  if (fieldSelector && fieldDropdown) {
    // 点击选择器显示/隐藏下拉菜单
    fieldSelector.addEventListener('click', (e) => {
      e.stopPropagation();
      const isCurrentlyOpen = fieldDropdown.classList.contains('show');
      fieldSelector.classList.toggle('open');
      fieldDropdown.classList.toggle('show');

      // 如果是打开下拉菜单
      if (!isCurrentlyOpen) {
        // 自动聚焦到搜索输入框
        const fieldSearchInput = document.getElementById('fieldSearchInput');
        if (fieldSearchInput) {
          setTimeout(() => {
            fieldSearchInput.focus();
            // 清空搜索框内容
            fieldSearchInput.value = '';
            // 触发过滤以显示所有选项
            filterFieldOptions();

            // 添加键盘事件监听器
            addKeyboardNavigation(fieldSearchInput);
          }, 0);
        }
      }
    });

    // 点击选项选择字段
    fieldDropdown.addEventListener('click', (e) => {
      if (e.target.classList.contains('field-option')) {
        const selectedField = e.target.getAttribute('data-field');
        document.getElementById('selectedField').textContent = selectedField;
        currentSearchField = selectedField;
        fieldSelector.classList.remove('open');
        fieldDropdown.classList.remove('show');

        // 重新渲染表格以应用新的搜索条件
        renderTable();
      }
    });

    // 点击页面其他地方隐藏下拉菜单
    document.addEventListener('click', (e) => {
      if (!fieldSelector.contains(e.target) && !fieldDropdown.contains(e.target)) {
        fieldSelector.classList.remove('open');
        fieldDropdown.classList.remove('show');
      }
    });

    console.log('字段选择器已绑定');
  }

  // 键盘导航功能
  function addKeyboardNavigation(searchInput) {
    let currentIndex = -1; // 当前选中的索引，-1表示未选中任何项
    const optionsContainer = document.getElementById('fieldOptionsContainer');

    // 监听键盘事件
    searchInput.addEventListener('keydown', (e) => {
      const options = optionsContainer ? Array.from(optionsContainer.querySelectorAll('.field-option:not([style*="display: none"])')) : [];

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (options.length > 0) {
            // 取消之前选中的项
            if (currentIndex >= 0 && options[currentIndex]) {
              options[currentIndex].classList.remove('selected');
            }

            // 移动到下一项
            currentIndex = (currentIndex + 1) % options.length;

            // 选中当前项
            options[currentIndex].classList.add('selected');
            options[currentIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
          break;

        case 'ArrowUp':
          e.preventDefault();
          if (options.length > 0) {
            // 取消之前选中的项
            if (currentIndex >= 0 && options[currentIndex]) {
              options[currentIndex].classList.remove('selected');
            }

            // 移动到上一项
            currentIndex = currentIndex <= 0 ? options.length - 1 : currentIndex - 1;

            // 选中当前项
            options[currentIndex].classList.add('selected');
            options[currentIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
          break;

        case 'Enter':
          e.preventDefault();
          if (currentIndex >= 0 && options[currentIndex]) {
            // 模拟点击选中的选项
            options[currentIndex].click();
          }
          break;

        case 'Escape':
          // 按ESC键关闭下拉菜单
          fieldSelector.classList.remove('open');
          fieldDropdown.classList.remove('show');
          break;
      }
    });
  }

  // 绑定版本号区域点击事件
  const versionArea = document.getElementById('versionArea');
  if (versionArea) {
    versionArea.addEventListener('click', showVersion);
    console.log('版本号区域已绑定');
  }

  // 绑定JSON模态框按钮
  const copyJsonBtn = document.getElementById('copyJsonBtn');
  if (copyJsonBtn) {
    copyJsonBtn.addEventListener('click', copyJsonInModal);
    console.log('复制JSON按钮已绑定');
  }

  const closeJsonModalBtn = document.getElementById('closeJsonModalBtn');
  if (closeJsonModalBtn) {
    closeJsonModalBtn.addEventListener('click', closeModal);
    console.log('关闭JSON模态框按钮已绑定');
  }

  // 绑定版本模态框按钮
  const closeVersionModalBtn = document.getElementById('closeVersionModalBtn');
  if (closeVersionModalBtn) {
    closeVersionModalBtn.addEventListener('click', closeVersionModal);
    console.log('关闭版本模态框按钮已绑定');
  }

  // 绑定模态框外部点击关闭
  const jsonOverlay = document.getElementById('jsonOverlay');
  if (jsonOverlay) {
    jsonOverlay.addEventListener('click', (e) => {
      // 只有当点击目标是模态框遮罩层时才关闭模态框
      if (e.target === jsonOverlay) {
        closeModal();
      }
    });
  }

  const versionOverlay = document.getElementById('versionOverlay');
  if (versionOverlay) {
    versionOverlay.addEventListener('click', (e) => {
      // 只有当点击目标是模态框遮罩层时才关闭模态框
      if (e.target === versionOverlay) {
        closeVersionModal();
      }
    });
  }

  // 阻止模态框内部点击事件冒泡
  const modalBoxes = document.querySelectorAll('.modal-box');
  modalBoxes.forEach(box => {
    box.addEventListener('click', (e) => {
      // 阻止事件冒泡到模态框遮罩层，避免意外关闭
      e.stopPropagation();
    });
  });

  // 绑定调试按钮
  const debugBtn = document.getElementById('debugBtn');
  if (debugBtn) {
    debugBtn.addEventListener('click', () => {
      const val = document.getElementById('rawInput').value;
      console.log('=== 调试信息 ===');
      console.log('原始数据长度:', val.length);
      console.log('前500字符:', val.substring(0, 500));

      // 显示字符码
      console.log('前100个字符的字符码:');
      for (let i = 0; i < Math.min(100, val.length); i++) {
        const char = val[i];
        const code = val.charCodeAt(i);
        console.log(`位置 ${i}: 字符码 ${code} = "${char}" (${code === 10 ? '换行符' : code === 13 ? '回车符' : code === 32 ? '空格' : '其他'})`);
      }

      // 检查特殊分隔符
      const patterns = [
        { pattern: ' | ', desc: '空格竖线空格' },
        { pattern: ' |', desc: '空格竖线' },
        { pattern: '| ', desc: '竖线空格' },
        { pattern: '+|', desc: '加号竖线' },
        { pattern: '+ |', desc: '加号空格竖线' }
      ];

      patterns.forEach(({ pattern, desc }) => {
        const count = (val.match(new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        console.log(`"${pattern}" (${desc}) 出现次数: ${count}`);
      });

      showToast('调试信息已输出到控制台');
    });
    console.log('调试按钮已绑定');
  }

  // 初始数据加载（从扩展存储）
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['markdownText', 'autoParse'], (result) => {
      console.log('从storage获取的数据:', result);
      if (result.markdownText && result.autoParse) {
        if (rawInput) {
          rawInput.value = result.markdownText;

          // 清空存储，避免下次打开时重复使用
          chrome.storage.local.remove(['markdownText', 'autoParse'], () => {
            console.log('已清除storage数据');
          });

          // 自动解析
          setTimeout(() => {
            console.log('开始自动解析数据');
            handleDataInput();
            showToast('已自动填充选中内容');
          }, 500);
        }
      }
    });
  }

  console.log('所有事件绑定完成');

  // 初始绑定单元格点击事件
  setTimeout(() => {
    bindCellClickEvents();
  }, 1000);


});

// ****************************************************************
// SQL生成器功能相关函数
// ****************************************************************

// 从SQL语句中提取表名的函数
function extractTableNames(sql) {
  if (!sql) return [];

  const tableNames = [];

  // 提取FROM子句后的表名（包括逗号分隔的多表和JOIN中的表）
  // 使用大小写不敏感的正则表达式查找关键词，但保留原始SQL中的表名大小写
  const fromRegex = /\bFROM\s+([^\s;][^;]*)/gi;
  let fromMatch;
  while ((fromMatch = fromRegex.exec(sql)) !== null) {
    let fromPart = fromMatch[1];

    // 处理括号中的子查询，只取最外层的表名部分
    if (fromPart.includes('(')) {
      // 简单处理括号，移除子查询部分，只保留表名
      let parenLevel = 0;
      let cleanedPart = '';
      for (let char of fromPart) {
        if (char === '(') parenLevel++;
        else if (char === ')') parenLevel--;
        else if (parenLevel === 0) cleanedPart += char;
      }
      fromPart = cleanedPart;
    }

    fromPart = fromPart.replace(/[\r\n\t]/g, ' ').trim();

    // 处理可能的多个表（逗号分隔或JOIN连接的表）
    // 按逗号分割，但要避免分割包含在括号内的内容
    const tables = [];
    let currentTable = '';
    let parenLevel = 0;

    for (let char of fromPart) {
      if (char === '(') parenLevel++;
      else if (char === ')') parenLevel--;
      else if (char === ',' && parenLevel === 0) {
        tables.push(currentTable.trim());
        currentTable = '';
        continue;
      }
      currentTable += char;
    }
    if (currentTable.trim()) {
      tables.push(currentTable.trim());
    }

    for (let i = 0; i < tables.length; i++) {
      const table = tables[i].split(/\s/)[0].replace(/[;\(\)]/g, '').trim(); // 只取表名部分，去除别名
      const upperTable = table.toUpperCase();

      if (table &&
        upperTable !== 'INNER' &&
        upperTable !== 'LEFT' &&
        upperTable !== 'RIGHT' &&
        upperTable !== 'FULL' &&
        upperTable !== 'OUTER' &&
        upperTable !== 'CROSS' &&
        upperTable !== 'JOIN' &&
        !upperTable.endsWith('JOIN')) {
        if (!tableNames.includes(table)) {
          tableNames.push(table);
        }
      }
    }
  }

  // 提取JOIN子句中的表名
  const joinRegex = /\b(INNER\s+|LEFT\s+|RIGHT\s+|FULL\s+|CROSS\s+)?JOIN\s+([^\s\(\);]+)/gi;
  let joinMatch;
  while ((joinMatch = joinRegex.exec(sql)) !== null) {
    const joinTable = joinMatch[2].split(/\s/)[0].replace(/[;\(\)]/g, '');
    if (joinTable && !tableNames.includes(joinTable)) {
      tableNames.push(joinTable);
    }
  }

  // 提取INSERT语句中的表名
  const insertRegex = /\bINSERT\s+INTO\s+([^\s\(\);]+)/i;
  const insertMatch = sql.match(insertRegex);
  if (insertMatch && insertMatch[1]) {
    const tableName = insertMatch[1].replace(/[;\(\)]/g, '');
    if (tableName && !tableNames.includes(tableName)) {
      tableNames.push(tableName);
    }
  }

  // 提取UPDATE语句中的表名
  const updateRegex = /\bUPDATE\s+([^\s;]+)/i;
  const updateMatch = sql.match(updateRegex);
  if (updateMatch && updateMatch[1]) {
    const tableName = updateMatch[1].replace(/[;\(\)]/g, '');
    if (tableName && !tableNames.includes(tableName)) {
      tableNames.push(tableName);
    }
  }

  // 提取DELETE语句中的表名
  const deleteRegex = /\bDELETE\s+FROM\s+([^\s;]+)/i;
  const deleteMatch = sql.match(deleteRegex);
  if (deleteMatch && deleteMatch[1]) {
    const tableName = deleteMatch[1].replace(/[;\(\)]/g, '');
    if (tableName && !tableNames.includes(tableName)) {
      tableNames.push(tableName);
    }
  }

  return tableNames;
}

// 检测是否为联表查询
function isJoinQuery(sql) {
  if (!sql) return false;

  const sqlUpper = sql.toUpperCase();

  // 检查是否存在JOIN关键字
  const joinKeywords = ['INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN', 'JOIN'];

  for (const keyword of joinKeywords) {
    if (sqlUpper.includes(keyword)) {
      return true;
    }
  }

  return false;
}

// 获取完整的FROM子句（包含JOIN部分）
function getFullFromClause(sql) {
  if (!sql) return '';

  const sqlUpper = sql.toUpperCase();

  // 查找FROM子句开始位置
  const fromIndex = sqlUpper.indexOf('FROM');
  if (fromIndex === -1) return '';

  // 查找FROM子句结束位置（在WHERE、GROUP BY、HAVING、ORDER BY、LIMIT之前）
  const afterFrom = sql.substring(fromIndex + 4); // 跳过'FROM'

  // 找到第一个关键子句的位置
  const clauseKeywords = ['WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', ';'];
  let endIndex = afterFrom.length;

  for (const keyword of clauseKeywords) {
    const keywordIndex = afterFrom.toUpperCase().indexOf(keyword);
    if (keywordIndex !== -1 && keywordIndex < endIndex) {
      endIndex = keywordIndex;
    }
  }

  // 提取FROM子句部分
  const fromClause = afterFrom.substring(0, endIndex).trim();

  return fromClause;
}

// 分析SQL中的字段与表的映射关系
function analyzeFieldTableMapping(sql) {
  if (!sql) return {};

  const mapping = {};
  const sqlUpper = sql.toUpperCase();

  // 提取SELECT子句中的字段和别名
  const selectMatch = sqlUpper.match(/SELECT\s+(.*?)\s+FROM/i);
  if (!selectMatch) return mapping;

  let selectFields = selectMatch[1];

  // 移除嵌套查询的可能干扰
  let parenCount = 0;
  let cleanSelectFields = '';
  for (let i = 0; i < selectFields.length; i++) {
    const char = selectFields[i];
    if (char === '(') parenCount++;
    else if (char === ')') parenCount--;
    if (parenCount >= 0) cleanSelectFields += char;
  }
  selectFields = cleanSelectFields;

  // 分割字段，考虑AS关键字和别名
  const fieldList = selectFields.split(',');

  for (let field of fieldList) {
    field = field.trim();

    // 处理 AS 别名的情况
    if (field.toUpperCase().includes(' AS ')) {
      const parts = field.split(/\s+AS\s+/i);
      if (parts.length >= 2) {
        const fieldName = parts[0].trim();
        const aliasName = parts[1].trim().replace(/[`"]/g, ''); // 移除可能的引号

        // 提取字段中的表前缀
        let tablePrefix = '';
        if (fieldName.includes('.')) {
          tablePrefix = fieldName.split('.')[0].trim();
        }

        mapping[aliasName] = tablePrefix;
      }
    } else {
      // 处理没有AS关键字但有空格作为别名的情况
      const fieldParts = field.trim().split(/\s+/);
      if (fieldParts.length > 1 && !field.toUpperCase().includes('FUNCTION') &&
        !field.toUpperCase().includes('COUNT') && !field.toUpperCase().includes('SUM') &&
        !field.toUpperCase().includes('AVG') && !field.toUpperCase().includes('MAX') &&
        !field.toUpperCase().includes('MIN')) {
        // 这可能是 "field alias" 的形式
        const fieldName = fieldParts[0].trim();
        const aliasName = fieldParts[1].trim().replace(/[`"]/g, '');

        let tablePrefix = '';
        if (fieldName.includes('.')) {
          tablePrefix = fieldName.split('.')[0].trim();
        }

        mapping[aliasName] = tablePrefix;
      } else {
        // 直接字段名
        const cleanField = field.trim().replace(/[`"]/g, '');
        let tablePrefix = '';
        if (cleanField.includes('.')) {
          tablePrefix = cleanField.split('.')[0].trim();
        }

        // 如果字段有表前缀，使用去掉前缀的字段名作为映射键
        if (cleanField.includes('.')) {
          const fieldNameWithoutPrefix = cleanField.split('.')[1].trim();
          mapping[fieldNameWithoutPrefix] = tablePrefix;
        } else {
          // 没有表前缀的字段，暂时标记为未知表
          mapping[cleanField] = tablePrefix || 'unknown';
        }
      }
    }
  }

  return mapping;
}

// 检测当前显示的列是否来自不同表
function detectMultipleTableSources(headers, columnOrder = []) {
  if (!extractedSql || !isJoinQuery(extractedSql)) {
    // 如果没有原始SQL或不是联表查询，返回false
    return false;
  }

  // 获取当前显示的列索引（activeCols）
  const visibleHeaderIndices = headers.map((header, index) => activeCols.has(index) ? index : -1).filter(index => index !== -1);

  // 根据columnOrder对可见列索引进行排序
  if (columnOrder && columnOrder.length > 0) {
    visibleHeaderIndices.sort((a, b) => {
      const aOrder = columnOrder.indexOf(a);
      const bOrder = columnOrder.indexOf(b);
      return aOrder - bOrder;
    });
  } else {
    // 如果没有columnOrder，则按自然顺序排序
    visibleHeaderIndices.sort((a, b) => a - b);
  }

  // 根据排序后的索引获取列名
  const visibleHeaders = visibleHeaderIndices.map(index => headers[index]);

  // 如果没有显示列，返回false
  if (visibleHeaders.length === 0) {
    return false;
  }

  // 分析字段与表的映射关系
  const fieldTableMapping = analyzeFieldTableMapping(extractedSql);

  // 获取显示列对应的表名
  const tableSources = [];
  for (const header of visibleHeaders) {
    // 检查字段映射中是否存在该字段
    const tableFromMapping = fieldTableMapping[header];
    if (tableFromMapping && tableFromMapping !== 'unknown') {
      tableSources.push(tableFromMapping);
    } else {
      // 如果字段映射中没有，尝试直接查找带前缀的字段名
      let found = false;
      for (const [mappedField, mappedTable] of Object.entries(fieldTableMapping)) {
        if (mappedField === header) {
          if (mappedTable && mappedTable !== 'unknown') {
            tableSources.push(mappedTable);
            found = true;
            break;
          }
        }
      }
      if (!found) {
        // 如果还是找不到，尝试从原始SQL中查找
        const sqlUpper = extractedSql.toUpperCase();
        const selectMatch = sqlUpper.match(/SELECT\s+(.*?)\s+FROM/i);
        if (selectMatch) {
          const selectFields = selectMatch[1];
          // 查找字段名是否包含表前缀
          const fieldPattern = new RegExp(`([a-zA-Z0-9_]+)\\.(${header})`, 'i');
          const match = selectFields.match(fieldPattern);
          if (match) {
            tableSources.push(match[1]);
          } else {
            // 如果没有找到表前缀，标记为未知表
            tableSources.push('unknown');
          }
        }
      }
    }
  }

  // 检查是否有多个不同的表来源
  const uniqueTables = [...new Set(tableSources)];

  console.log('检测到的表来源:', uniqueTables, '字段映射:', fieldTableMapping, '显示列:', visibleHeaders);

  // 如果有多个不同的表来源（排除'unknown'），返回true
  const actualTables = uniqueTables.filter(table => table !== 'unknown');
  return actualTables.length > 1;
}

// 根据表格数据生成SELECT SQL
function generateSelectSQL(tableName, headers, filteredRows, columnOrder = []) {
  if (!tableName || !headers || !filteredRows) return '';

  // 获取当前显示的列索引（activeCols）
  const visibleHeaderIndices = headers.map((header, index) => activeCols.has(index) ? index : -1).filter(index => index !== -1);

  // 根据columnOrder对可见列索引进行排序
  if (columnOrder && columnOrder.length > 0) {
    visibleHeaderIndices.sort((a, b) => {
      const aOrder = columnOrder.indexOf(a);
      const bOrder = columnOrder.indexOf(b);
      return aOrder - bOrder;
    });
  } else {
    // 如果没有columnOrder，则按自然顺序排序
    visibleHeaderIndices.sort((a, b) => a - b);
  }

  // 根据排序后的索引获取列名
  const visibleHeaders = visibleHeaderIndices.map(index => headers[index]);
  const selectedColumns = visibleHeaders.length > 0 ? visibleHeaders.join(', ') : '*';

  // 检测原始SQL是否为联表查询
  let fromClause = tableName;
  if (extractedSql && isJoinQuery(extractedSql)) {
    // 如果是联表查询，使用原始SQL的FROM子句
    fromClause = getFullFromClause(extractedSql);
    console.log('检测到联表查询，使用原始FROM子句:', fromClause);
  } else {
    console.log('非联表查询，使用单表:', tableName);
  }

  // 获取第一列的名称（可见列中的第一列）
  let firstColumnName = null;
  if (visibleHeaders.length > 0) {
    firstColumnName = visibleHeaders[0]; // 使用第一个可见列
  } else if (headers.length > 0) {
    firstColumnName = headers[0]; // 如果没有可见列，则使用第一个列
  }

  // 如果有过滤条件，使用过滤后的行构建WHERE IN条件
  if (filteredRows.length > 0 && firstColumnName) {
    // 获取第一列的所有值
    const firstColumnValues = filteredRows.map(row => {
      // 找到第一列在行中的索引
      const firstColIndex = headers.findIndex(header => header === firstColumnName);
      if (firstColIndex !== -1 && row[firstColIndex] !== undefined) {
        let value = row[firstColIndex];
        // 根据值的类型进行适当的格式化
        if (value === null || value === undefined) {
          return 'NULL';
        } else if (typeof value === 'string') {
          // 转义字符串值
          return `'${value.replace(/'/g, "''")}'`;
        } else {
          return value;
        }
      }
      return null;
    }).filter(val => val !== null); // 过滤掉null值

    if (firstColumnValues.length > 0) {
      let whereClause = '';
      if (extractedSql && isJoinQuery(extractedSql)) {
        // 如果是联表查询，为字段添加表前缀
        const fieldTableMapping = analyzeFieldTableMapping(extractedSql);
        const tablePrefix = fieldTableMapping[firstColumnName] || 'unknown';
        if (tablePrefix && tablePrefix !== 'unknown') {
          whereClause = `${tablePrefix}.${firstColumnName} IN (${firstColumnValues.join(', ')})`;
        } else {
          // 如果无法确定表前缀，使用原始字段名
          whereClause = `${firstColumnName} IN (${firstColumnValues.join(', ')})`;
        }
      } else {
        whereClause = `${firstColumnName} IN (${firstColumnValues.join(', ')})`;
      }
      return `SELECT ${selectedColumns} FROM ${fromClause} WHERE ${whereClause};`;
    }
  }

  // 如果没有过滤条件或无法构建WHERE条件，生成基本的SELECT语句
  return `SELECT ${selectedColumns} FROM ${fromClause};`;
}

// 根据表格数据生成INSERT SQL
function generateInsertSQL(tableName, headers, rowsToInsert, columnOrder = []) {
  // 检测是否来自多个表，如果是则阻止生成并提示
  if (detectMultipleTableSources(headers, columnOrder)) {
    return ''; // 不显示toast，由模态框处理
  }

  if (!tableName || !headers || !rowsToInsert || rowsToInsert.length === 0) return '';

  // 获取当前显示的列索引（activeCols）
  const visibleHeaderIndices = headers.map((header, index) => activeCols.has(index) ? index : -1).filter(index => index !== -1);

  // 根据columnOrder对可见列索引进行排序
  if (columnOrder && columnOrder.length > 0) {
    visibleHeaderIndices.sort((a, b) => {
      const aOrder = columnOrder.indexOf(a);
      const bOrder = columnOrder.indexOf(b);
      return aOrder - bOrder;
    });
  } else {
    // 如果没有columnOrder，则按自然顺序排序
    visibleHeaderIndices.sort((a, b) => a - b);
  }

  // 根据排序后的索引获取列名
  const visibleHeaders = visibleHeaderIndices.map(index => headers[index]);
  // 获取对应的列索引
  const visibleIndices = visibleHeaderIndices;

  const columns = visibleHeaders.join(', ');
  const valueSets = [];

  rowsToInsert.forEach(row => {
    // 只取可见列的值
    const visibleValues = visibleIndices.map(index => row[index]);

    const values = visibleValues.map(cell => {
      // 根据值的类型进行适当的转义
      if (cell === null || cell === undefined) {
        return 'NULL';
      } else if (typeof cell === 'string') {
        // 简单的字符串转义，实际应用中可能需要更安全的转义方法
        return `'${cell.replace(/'/g, "''")}'`;
      } else {
        return cell;
      }
    });

    valueSets.push(`(${values.join(', ')})`);
  });

  return `INSERT INTO ${tableName} (${columns}) VALUES\n${valueSets.join(',\n')};`;
}

// 根据过滤结果生成DELETE SQL
function generateDeleteSQL(tableName, headers, filteredRows, columnOrder = []) {
  // 检测是否来自多个表，如果是则阻止生成并提示
  if (detectMultipleTableSources(headers, columnOrder)) {
    return ''; // 不显示toast，由模态框处理
  }

  if (!tableName || !headers || !filteredRows) return '';

  // 获取当前显示的列索引（activeCols）
  const visibleHeaderIndices = headers.map((header, index) => activeCols.has(index) ? index : -1).filter(index => index !== -1);

  // 根据columnOrder对可见列索引进行排序
  if (columnOrder && columnOrder.length > 0) {
    visibleHeaderIndices.sort((a, b) => {
      const aOrder = columnOrder.indexOf(a);
      const bOrder = columnOrder.indexOf(b);
      return aOrder - bOrder;
    });
  } else {
    // 如果没有columnOrder，则按自然顺序排序
    visibleHeaderIndices.sort((a, b) => a - b);
  }

  // 根据排序后的索引获取列名
  const visibleHeaders = visibleHeaderIndices.map(index => headers[index]);

  // 获取第一列的名称（可见列中的第一列）
  let firstColumnName = null;
  if (visibleHeaders.length > 0) {
    firstColumnName = visibleHeaders[0]; // 使用第一个可见列
  } else if (headers.length > 0) {
    firstColumnName = headers[0]; // 如果没有可见列，则使用第一个列
  }

  // 如果有过滤条件，使用过滤后的行构建WHERE IN条件
  if (filteredRows.length > 0 && firstColumnName) {
    // 获取第一列的所有值
    const firstColumnValues = filteredRows.map(row => {
      // 找到第一列在行中的索引
      const firstColIndex = headers.findIndex(header => header === firstColumnName);
      if (firstColIndex !== -1 && row[firstColIndex] !== undefined) {
        let value = row[firstColIndex];
        // 根据值的类型进行适当的格式化
        if (value === null || value === undefined) {
          return 'NULL';
        } else if (typeof value === 'string') {
          // 转义字符串值
          return `'${value.replace(/'/g, "''")}'`;
        } else {
          return value;
        }
      }
      return null;
    }).filter(val => val !== null); // 过滤掉null值

    if (firstColumnValues.length > 0) {
      let whereClause = '';
      if (extractedSql && isJoinQuery(extractedSql)) {
        // 如果是联表查询，为字段添加表前缀
        const fieldTableMapping = analyzeFieldTableMapping(extractedSql);
        const tablePrefix = fieldTableMapping[firstColumnName] || 'unknown';
        if (tablePrefix && tablePrefix !== 'unknown') {
          whereClause = `${tablePrefix}.${firstColumnName} IN (${firstColumnValues.join(', ')})`;
        } else {
          // 如果无法确定表前缀，使用原始字段名
          whereClause = `${firstColumnName} IN (${firstColumnValues.join(', ')})`;
        }
      } else {
        whereClause = `${firstColumnName} IN (${firstColumnValues.join(', ')})`;
      }
      return `DELETE FROM ${tableName} WHERE ${whereClause};`;
    }
  }

  // 如果没有过滤条件或无法构建WHERE条件，生成基本的DELETE语句
  return `DELETE FROM ${tableName};`;
}

// 获取当前过滤状态的函数
function getCurrentFilterState() {
  const q = document.getElementById('rowSearch').value.toLowerCase();
  const currentSearchField = document.getElementById('selectedField').textContent;

  return {
    searchQuery: q,
    searchField: currentSearchField,
    activeCols: Array.from(activeCols),
    columnOrder: [...columnOrder], // 包含列顺序信息
    filteredRows: getFilteredRows() // 需要一个函数来获取当前过滤后的行
  };
}

// 获取当前过滤后的行
function getFilteredRows() {
  const q = document.getElementById('rowSearch').value.toLowerCase();
  const currentSearchField = document.getElementById('selectedField').textContent;

  // 复用渲染函数中的过滤逻辑
  let filteredRows = rows.filter(r => {
    if (!q) return true;

    if (currentSearchField === '全部字段') {
      // 在所有激活列中搜索
      return r.some((cell, idx) => {
        // 只检查活跃列
        if (!activeCols.has(idx)) return false;
        const cellText = cell ? String(cell).toLowerCase() : '';
        return cellText.includes(q);
      });
    } else {
      // 只在选定字段中搜索
      const fieldIndex = headers.indexOf(currentSearchField);
      // 检查字段是否存在且在激活列中
      if (fieldIndex === -1 || !activeCols.has(fieldIndex)) return false;
      const cellText = r[fieldIndex] ? String(r[fieldIndex]).toLowerCase() : '';
      return cellText.includes(q);
    }
  });

  return filteredRows;
}

// 比较过滤状态是否相同
function isFilterStateEqual(state1, state2) {
  if (!state1 || !state2) return false;

  return state1.searchQuery === state2.searchQuery &&
    state1.searchField === state2.searchField &&
    JSON.stringify(state1.activeCols) === JSON.stringify(state2.activeCols) &&
    JSON.stringify(state1.columnOrder) === JSON.stringify(state2.columnOrder) &&
    state1.filteredRows.length === state2.filteredRows.length &&
    state1.tableName === state2.tableName; // 比较表名
}

// 打开SQL生成器模态框
function openSqlGeneratorModal() {
  console.log('openSqlGeneratorModal函数被调用');

  try {
    // 获取当前过滤状态
    const filterState = getCurrentFilterState();
    console.log('获取过滤状态成功:', filterState);

    // 尝试从现有SQL中提取表名
    let tableNames = [];
    if (extractedSql) {
      console.log('尝试从现有SQL中提取表名:', extractedSql);
      tableNames = extractTableNames(extractedSql);
      console.log('提取到的表名:', tableNames);
    } else {
      console.log('没有现有SQL，需要用户输入表名');
    }

    // 始终显示SQL生成器模态框，让模态框处理是否有表名的情况
    showSqlGeneratorInput(filterState, tableNames);
    console.log('SQL生成器输入模态框已打开');
  } catch (error) {
    console.error('openSqlGeneratorModal函数执行出错:', error);
    alert('打开SQL生成器时出现错误，请查看控制台了解详细信息');
  }
}

// 显示SQL生成器输入界面
function showSqlGeneratorInput(filterState, tableNames = []) {
  console.log('showSqlGeneratorInput函数被调用', { filterState, tableNames });

  // 确定默认表名
  let defaultTableName = '';
  let canAutoFill = false;
  let isJoinQueryDetected = false;

  if (tableNames && tableNames.length > 0) {
    defaultTableName = tableNames[0];
    // 检查是否是联表查询，但根据用户需求，即使检测到联表查询也要自动填充
    if (extractedSql && isJoinQuery(extractedSql)) {
      isJoinQueryDetected = true;
      canAutoFill = true; // 联表查询时也要自动填充
    } else {
      canAutoFill = true;
    }
  }

  // 创建模态框HTML，根据是否有提取的表名来决定显示内容
  let modalHtml = `
    <div class="sql-generator-modal" id="sqlGeneratorModal" style="
      position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
      background: rgba(0,0,0,0.7); display: flex; align-items: center; 
      justify-content: center; z-index: 100000; backdrop-filter: blur(5px);">
      <div class="sql-generator-modal-content" style="
        background: var(--panel); border-radius: 16px; padding: 24px; 
        width: 90%; max-width: 800px; max-height: 80vh; 
        overflow: auto; overflow-x: hidden; border: 1px solid var(--border); 
        box-shadow: var(--shadow);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <h3 style="margin: 0; color: var(--primary); font-size: 18px; font-weight: 600;">🔧 SQL生成器</h3>
          <button id="closeSqlGenModal" class="btn" style="
            background: rgba(239, 68, 68, 0.1); color: #ef4444; 
            border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 6px 12px; 
            cursor: pointer; font-size: 14px; min-width: 60px; transition: all 0.2s ease;">
            关闭
          </button>
        </div>
        
        ${canAutoFill ? `
        <!-- 当有自动提取的表名时，隐藏表名输入，直接显示提示信息 -->
        <div style="margin-bottom: 20px; padding: 12px; background: rgba(59, 130, 246, 0.1); border-radius: 8px; color: var(--secondary); font-size: 14px; border-left: 4px solid #3b82f6;">
          ${isJoinQueryDetected ? '检测到联表查询，已自动使用提取的表名生成SQL' : `已从现有SQL中自动提取表名: <strong>${escapeHtml(defaultTableName)}</strong>`}
        </div>
        ` : `
        <!-- 当没有自动提取的表名时，显示表名输入 -->
        <div style="margin-bottom: 24px;">
          <label for="tableNameInput" style="display: block; margin-bottom: 8px; color: var(--text); font-weight: 500; font-size: 14px;">表名:</label>
          <input type="text" id="tableNameInput" value="${escapeHtml(defaultTableName)}" placeholder="请输入表名" style="
            width: 100%; padding: 12px; border: 1px solid var(--border); 
            border-radius: 8px; background: var(--input-bg); color: var(--text);
            font-size: 14px; margin-bottom: 8px; transition: border-color 0.2s ease;">
          <p style="margin: 5px 0; color: var(--secondary); font-size: 12px;">请手动输入表名以生成SQL语句</p>
        </div>
        
        <button id="generateSqlBtnFromModal" class="btn" style="
          background: var(--primary); color: white; 
          border: 1px solid var(--border); border-radius: 8px; 
          padding: 14px 24px; margin-bottom: 20px; 
          cursor: pointer; font-size: 15px; width: 100%;
          font-weight: 500; transition: all 0.2s ease; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          🗃️ 生成SQL
        </button>
        `}
        
        <!-- SQL结果显示区域，初始隐藏 -->
        <div id="sqlResultsContainer" style="display: none;">
          <div style="margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <h4 style="margin: 0; color: var(--text); font-size: 15px; font-weight: 600; display: flex; align-items: center;">
                <span style="display: inline-block; width: 8px; height: 8px; background: #3b82f6; border-radius: 50%; margin-right: 8px;"></span>
                SELECT 语句:
              </h4>
            </div>
            <textarea id="selectSqlTextarea" style="
              width: 100%; height: 150px; font-family: 'Fira Code', monospace; 
              font-size: 13px; padding: 14px; border: 1px solid var(--border); 
              border-radius: 8px; background: var(--card-bg); color: var(--text);
              resize: vertical; margin: 5px 0; white-space: pre-wrap; overflow: auto;"></textarea>
            <button class="sql-gen-btn select-btn btn" style="
              background: rgba(59, 130, 246, 0.2); color: #3b82f6; 
              border: 1px solid var(--border); border-radius: 6px; 
              padding: 10px 14px; margin-top: 8px; cursor: pointer; 
              font-size: 13px; transition: all 0.2s ease; font-weight: 500;">
              📋 复制SELECT
            </button>
          </div>
          
          <div id="insertSqlSection" style="margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <h4 style="margin: 0; color: var(--text); font-size: 15px; font-weight: 600; display: flex; align-items: center;">
                <span style="display: inline-block; width: 8px; height: 8px; background: #10b981; border-radius: 50%; margin-right: 8px;"></span>
                INSERT 语句:
              </h4>
            </div>
            <textarea id="insertSqlTextarea" style="
              width: 100%; height: 150px; font-family: 'Fira Code', monospace; 
              font-size: 13px; padding: 14px; border: 1px solid var(--border); 
              border-radius: 8px; background: var(--card-bg); color: var(--text);
              resize: vertical; margin: 5px 0; white-space: pre-wrap; overflow: auto;"></textarea>
            <button class="sql-gen-btn insert-btn btn" style="
              background: rgba(16, 185, 129, 0.2); color: #10b981; 
              border: 1px solid var(--border); border-radius: 6px; 
              padding: 10px 14px; margin-top: 8px; cursor: pointer; 
              font-size: 13px; transition: all 0.2s ease; font-weight: 500;">
              📋 复制INSERT
            </button>
          </div>
          
          <div id="deleteSqlSection" style="margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <h4 style="margin: 0; color: var(--text); font-size: 15px; font-weight: 600; display: flex; align-items: center;">
                <span style="display: inline-block; width: 8px; height: 8px; background: #ef4444; border-radius: 50%; margin-right: 8px;"></span>
                DELETE 语句:
              </h4>
            </div>
            <textarea id="deleteSqlTextarea" style="
              width: 100%; height: 150px; font-family: 'Fira Code', monospace; 
              font-size: 13px; padding: 14px; border: 1px solid var(--border); 
              border-radius: 8px; background: var(--card-bg); color: var(--text);
              resize: vertical; margin: 5px 0; white-space: pre-wrap; overflow: auto;"></textarea>
            <button class="sql-gen-btn delete-btn btn" style="
              background: rgba(239, 68, 68, 0.2); color: #ef4444; 
              border: 1px solid var(--border); border-radius: 6px; 
              padding: 10px 14px; margin-top: 8px; cursor: pointer; 
              font-size: 13px; transition: all 0.2s ease; font-weight: 500;">
              📋 复制DELETE
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  console.log('模态框HTML创建完成');

  // 添加到页面
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  console.log('模态框已添加到页面');

  // 绑定关闭按钮事件
  const closeBtn = document.getElementById('closeSqlGenModal');
  if (closeBtn) {
    closeBtn.addEventListener('click', function () {
      document.getElementById('sqlGeneratorModal').remove();
      console.log('关闭按钮事件绑定成功');
    });
  } else {
    console.error('未找到关闭按钮元素');
  }

  // 添加点击外部关闭功能
  setTimeout(() => {
    const modal = document.getElementById('sqlGeneratorModal');
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) {
          modal.remove();
        }
      });
    }
  }, 10); // 延迟执行以确保DOM元素已创建

  // 只有在不需要自动填充时才绑定生成SQL按钮事件
  if (!canAutoFill) {
    const generateBtn = document.getElementById('generateSqlBtnFromModal');
    if (generateBtn) {
      generateBtn.addEventListener('click', function () {
        const tableName = document.getElementById('tableNameInput').value.trim();
        if (!tableName) {
          alert('请输入表名');
          return;
        }

        // 生成SQL并显示结果
        generateAndShowSql(filterState, tableName);
      });
    }

    // 添加表名输入框的Enter键支持
    const tableNameInput = document.getElementById('tableNameInput');
    if (tableNameInput) {
      tableNameInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
          const tableName = tableNameInput.value.trim();
          if (!tableName) {
            alert('请输入表名');
            return;
          }
          generateAndShowSql(filterState, tableName);
        }
      });
    }
  }

  // 如果可以自动填充（包括联表查询），自动执行SQL生成
  if (canAutoFill) {
    // 自动执行SQL生成，使用提取的表名
    setTimeout(() => {
      generateAndShowSql(filterState, defaultTableName);
    }, 100); // 延迟执行以确保DOM元素已创建
    console.log('已从现有SQL提取表名，自动执行SQL生成');
  }

  console.log('SQL生成器输入界面初始化完成');
}

// 生成SQL并显示结果
function generateAndShowSql(filterState, tableName) {
  console.log('generateAndShowSql函数被调用', { tableName });

  try {
    // 检查缓存是否仍然有效（但需要考虑表名）
    let selectSql, insertSql, deleteSql;
    const currentCache = sqlGenerationCache.lastFilterState;

    if (currentCache &&
      isFilterStateEqual(filterState, currentCache)) {
      // 使用缓存的SQL
      selectSql = sqlGenerationCache.cachedSelectSql;
      insertSql = sqlGenerationCache.cachedInsertSql;
      deleteSql = sqlGenerationCache.cachedDeleteSql;
      console.log('使用缓存的SQL');
    } else {
      console.log('缓存无效，重新生成SQL');

      // 根据过滤状态生成SQL选项
      console.log('开始生成SELECT SQL');
      selectSql = generateSelectSQL(tableName, headers, filterState.filteredRows, filterState.columnOrder);
      console.log('SELECT SQL生成完成:', selectSql);

      console.log('开始生成INSERT SQL');
      insertSql = generateInsertSQL(tableName, headers, filterState.filteredRows, filterState.columnOrder);
      console.log('INSERT SQL生成完成:', insertSql);

      console.log('开始生成DELETE SQL');
      deleteSql = generateDeleteSQL(tableName, headers, filterState.filteredRows, filterState.columnOrder);
      console.log('DELETE SQL生成完成:', deleteSql);

      // 更新缓存，包含表名
      sqlGenerationCache.lastFilterState = {
        searchQuery: filterState.searchQuery,
        searchField: filterState.searchField,
        activeCols: [...filterState.activeCols],
        columnOrder: [...filterState.columnOrder],
        filteredRows: [...filterState.filteredRows],
        tableName: tableName  // 添加表名到缓存键
      };
      sqlGenerationCache.cachedSelectSql = selectSql;
      sqlGenerationCache.cachedInsertSql = insertSql;
      sqlGenerationCache.cachedDeleteSql = deleteSql;

      console.log('生成新的SQL并更新缓存');
    }

    // 显示SQL结果
    showSqlResults(selectSql, insertSql, deleteSql);
  } catch (error) {
    console.error('生成SQL时出错:', error);
    alert('生成SQL时出现错误，请查看控制台了解详细信息');
  }
}

// 显示SQL结果
function showSqlResults(selectSql, insertSql, deleteSql) {
  console.log('showSqlResults函数被调用', { selectSql, insertSql, deleteSql });

  // 显示结果区域
  const resultsContainer = document.getElementById('sqlResultsContainer');
  if (resultsContainer) {
    resultsContainer.style.display = 'block';
  }

  // 格式化SQL语句
  const formattedSelectSql = formatSql(selectSql);

  // 填充SELECT SQL文本框
  const selectTextarea = document.getElementById('selectSqlTextarea');
  if (selectTextarea) selectTextarea.value = formattedSelectSql;

  // 处理INSERT SQL - 保留标题和文本框，只根据是否能生成来决定是否显示提示信息和绑定按钮
  const insertSqlSection = document.getElementById('insertSqlSection');
  const insertTextarea = document.getElementById('insertSqlTextarea');
  if (insertTextarea) {
    if (insertSql && insertSql.trim() !== '') {
      const formattedInsertSql = formatSql(insertSql);
      insertTextarea.value = formattedInsertSql;
    } else {
      insertTextarea.value = '❌ 选中的字段来自不同表，无法生成 INSERT 语句';
    }
  }

  // 处理DELETE SQL - 保留标题和文本框，只根据是否能生成来决定是否显示提示信息和绑定按钮
  const deleteSqlSection = document.getElementById('deleteSqlSection');
  const deleteTextarea = document.getElementById('deleteSqlTextarea');
  if (deleteTextarea) {
    if (deleteSql && deleteSql.trim() !== '') {
      const formattedDeleteSql = formatSql(deleteSql);
      deleteTextarea.value = formattedDeleteSql;
    } else {
      deleteTextarea.value = '❌ 选中的字段来自不同表，无法生成 DELETE 语句';
    }
  }

  // 绑定复制按钮事件
  const selectBtn = document.querySelector('.select-btn');
  if (selectBtn) {
    selectBtn.removeEventListener('click', selectBtn._clickHandler);
    const clickHandler = function () {
      const sqlText = document.getElementById('selectSqlTextarea').value;
      navigator.clipboard.writeText(sqlText).then(() => {
        showToast('SELECT SQL已复制到剪贴板');
      });
    };
    selectBtn.addEventListener('click', clickHandler);
    selectBtn._clickHandler = clickHandler;
  }

  // 仅在INSERT SQL有效时显示复制按钮
  const insertBtn = document.querySelector('.insert-btn');
  if (insertBtn) {
    insertBtn.removeEventListener('click', insertBtn._clickHandler);
    if (insertSql && insertSql.trim() !== '') {
      const clickHandler = function () {
        const sqlText = document.getElementById('insertSqlTextarea').value;
        navigator.clipboard.writeText(sqlText).then(() => {
          showToast('INSERT SQL已复制到剪贴板');
        });
      };
      insertBtn.addEventListener('click', clickHandler);
      insertBtn._clickHandler = clickHandler;
      insertBtn.style.display = 'inline-block'; // 显示按钮
    } else {
      insertBtn.style.display = 'none'; // 隐藏按钮
    }
  }

  // 仅在DELETE SQL有效时显示复制按钮
  const deleteBtn = document.querySelector('.delete-btn');
  if (deleteBtn) {
    deleteBtn.removeEventListener('click', deleteBtn._clickHandler);
    if (deleteSql && deleteSql.trim() !== '') {
      const clickHandler = function () {
        const sqlText = document.getElementById('deleteSqlTextarea').value;
        navigator.clipboard.writeText(sqlText).then(() => {
          showToast('DELETE SQL已复制到剪贴板');
        });
      };
      deleteBtn.addEventListener('click', clickHandler);
      deleteBtn._clickHandler = clickHandler;
      deleteBtn.style.display = 'inline-block'; // 显示按钮
    } else {
      deleteBtn.style.display = 'none'; // 隐藏按钮
    }
  }

  console.log('SQL结果显示完成');
}

// 显示SQL生成选项
function showSqlGenerationOptions(selectSql, insertSql, deleteSql) {
  console.log('showSqlGenerationOptions函数被调用', { selectSql, insertSql, deleteSql });

  // 检查INSERT和DELETE SQL是否为空，如果是，则显示提示信息
  let insertSqlToShow = insertSql;
  let deleteSqlToShow = deleteSql;

  if (!insertSql || insertSql.trim() === '') {
    insertSqlToShow = '❌ 选中的字段来自不同表，无法生成 INSERT 语句';
  }

  if (!deleteSql || deleteSql.trim() === '') {
    deleteSqlToShow = '❌ 选中的字段来自不同表，无法生成 DELETE 语句';
  }

  // 格式化SQL语句
  const formattedSelectSql = formatSql(selectSql);
  const formattedInsertSql = insertSqlToShow.startsWith('❌') ? insertSqlToShow : formatSql(insertSql);
  const formattedDeleteSql = deleteSqlToShow.startsWith('❌') ? deleteSqlToShow : formatSql(deleteSql);

  // 创建一个临时的模态框来显示SQL选项
  let modalHtml = `
    <div class="sql-generator-modal" id="sqlGeneratorModal" style="
      position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
      background: rgba(0,0,0,0.7); display: flex; align-items: center; 
      justify-content: center; z-index: 100000; backdrop-filter: blur(5px);">
      <div style="
        background: var(--panel); border-radius: 12px; padding: 20px; 
        width: 90%; max-width: 800px; max-height: 80vh; 
        overflow: auto; border: 1px solid var(--border); 
        box-shadow: var(--shadow);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
          <h3 style="margin: 0; color: var(--primary);">🔧 SQL生成器</h3>
          <button id="closeSqlGenModal" style="
            background: rgba(239, 68, 68, 0.1); color: #ef4444; 
            border: none; border-radius: 6px; padding: 5px 10px; 
            cursor: pointer; font-size: 14px;">关闭</button>
        </div>
        
        <div style="margin-bottom: 15px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
            <h4 style="margin: 0; color: var(--text);">SELECT 语句:</h4>
          </div>
          <textarea id="selectSqlTextarea" style="
            width: 100%; height: 150px; font-family: 'Fira Code', monospace; 
            font-size: 12px; padding: 12px; border: 1px solid var(--border); 
            border-radius: 8px; background: var(--card-bg); color: var(--text);
            resize: vertical; margin: 5px 0; white-space: pre-wrap; overflow: auto;">${escapeHtml(formattedSelectSql)}</textarea>
          <button class="sql-gen-btn select-btn" style="
            background: rgba(59, 130, 246, 0.2); color: #3b82f6; 
            border: 1px solid var(--border); border-radius: 6px; 
            padding: 8px 12px; margin-top: 8px; cursor: pointer; 
            font-size: 13px;">复制SELECT</button>
        </div>
        
        <div style="margin-bottom: 15px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
            <h4 style="margin: 0; color: var(--text);">INSERT 语句:</h4>
          </div>
          <textarea id="insertSqlTextarea" style="
            width: 100%; height: 150px; font-family: 'Fira Code', monospace; 
            font-size: 12px; padding: 12px; border: 1px solid var(--border); 
            border-radius: 8px; background: var(--card-bg); color: var(--text);
            resize: vertical; margin: 5px 0; white-space: pre-wrap; overflow: auto;">${escapeHtml(formattedInsertSql)}</textarea>
          ${insertSqlToShow.startsWith('❌') ? '' : `<button class="sql-gen-btn insert-btn" style="
            background: rgba(16, 185, 129, 0.2); color: #10b981; 
            border: 1px solid var(--border); border-radius: 6px; 
            padding: 8px 12px; margin-top: 8px; cursor: pointer; 
            font-size: 13px;">复制INSERT</button>`}
        </div>
        
        <div style="margin-bottom: 15px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
            <h4 style="margin: 0; color: var(--text);">DELETE 语句:</h4>
          </div>
          <textarea id="deleteSqlTextarea" style="
            width: 100%; height: 150px; font-family: 'Fira Code', monospace; 
            font-size: 12px; padding: 12px; border: 1px solid var(--border); 
            border-radius: 8px; background: var(--card-bg); color: var(--text);
            resize: vertical; margin: 5px 0; white-space: pre-wrap; overflow: auto;">${escapeHtml(formattedDeleteSql)}</textarea>
          ${deleteSqlToShow.startsWith('❌') ? '' : `<button class="sql-gen-btn delete-btn" style="
            background: rgba(239, 68, 68, 0.2); color: #ef4444; 
            border: 1px solid var(--border); border-radius: 6px; 
            padding: 8px 12px; margin-top: 8px; cursor: pointer; 
            font-size: 13px;">复制DELETE</button>`}
        </div>
      </div>
    </div>
  `;

  console.log('模态框HTML创建完成');

  // 添加到页面
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  console.log('模态框已添加到页面');

  // 绑定事件
  const closeBtn = document.getElementById('closeSqlGenModal');
  if (closeBtn) {
    closeBtn.addEventListener('click', function () {
      document.getElementById('sqlGeneratorModal').remove();
      console.log('关闭按钮事件绑定成功');
    });
  } else {
    console.error('未找到关闭按钮元素');
  }

  console.log('SQL文本框已初始化');

  // 复制按钮事件
  const selectBtn = document.querySelector('.select-btn');
  if (selectBtn) {
    selectBtn.addEventListener('click', function () {
      const sqlText = document.getElementById('selectSqlTextarea').value;
      navigator.clipboard.writeText(sqlText).then(() => {
        showToast('SELECT SQL已复制到剪贴板');
      });
    });
    console.log('SELECT复制按钮事件绑定成功');
  } else {
    console.error('未找到SELECT复制按钮');
  }

  const insertBtn = document.querySelector('.insert-btn');
  if (insertBtn) {
    insertBtn.addEventListener('click', function () {
      const sqlText = document.getElementById('insertSqlTextarea').value;
      // 如果是提示信息，则不复制
      if (sqlText.startsWith('❌')) {
        showToast('无法复制INSERT SQL：' + sqlText.substring(3));
      } else {
        navigator.clipboard.writeText(sqlText).then(() => {
          showToast('INSERT SQL已复制到剪贴板');
        });
      }
    });
    console.log('INSERT复制按钮事件绑定成功');
  } else {
    console.error('未找到INSERT复制按钮');
  }

  const deleteBtn = document.querySelector('.delete-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', function () {
      const sqlText = document.getElementById('deleteSqlTextarea').value;
      // 如果是提示信息，则不复制
      if (sqlText.startsWith('❌')) {
        showToast('无法复制DELETE SQL：' + sqlText.substring(3));
      } else {
        navigator.clipboard.writeText(sqlText).then(() => {
          showToast('DELETE SQL已复制到剪贴板');
        });
      }
    });
    console.log('DELETE复制按钮事件绑定成功');
  } else {
    console.error('未找到DELETE复制按钮');
  }

  console.log('showSqlGenerationOptions函数执行完成');
}



// HTML转义函数
function escapeHtml(text) {
  if (typeof text !== 'string') return text;
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// 将SQL生成器函数暴露到全局作用域
window.openSqlGeneratorModal = openSqlGeneratorModal;