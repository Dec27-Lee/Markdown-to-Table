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

// 清空输入框时清空所有数据和界面
function clearAllData() {
  console.log('清空所有数据');

  // 清空全局变量
  headers = [];
  rows = [];
  activeCols = new Set();
  sortInfo = { idx: -1, asc: true, state: 'none' };

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

  console.log('数据已清空');
}

// 切换主题模式（深色/浅色）
function toggleTheme() {
  // 获取当前主题
  const currentTheme = document.body.dataset.theme;
  // 确定新主题（在深色和浅色之间切换）
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  // 应用新主题
  document.body.dataset.theme = newTheme;

  // 添加主题切换动画
  document.body.style.opacity = '0.8';
  setTimeout(() => {
    document.body.style.opacity = '1';
  }, 150);
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

  // 预处理：移除所有边框行（包含连续+的行）
  const processedText = rawText
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      // 过滤掉纯边框行：包含+但不包含字母数字
      if (trimmed.includes('+') && !trimmed.match(/[a-zA-Z0-9]/)) {
        return false;
      }
      return trimmed.length > 0;
    })
    .join('\n');

  console.log('预处理后的文本:', processedText);

  // 按行分割
  const lines = processedText.trim().split('\n');

  // 如果行数少于2行（至少需要一行表头和一行数据），显示错误信息并清空数据
  if (lines.length < 2) {
    showToast('数据格式不正确');
    clearAllData();
    return;
  }

  // 解析表头
  const parsedHeaders = parseTableLine(lines[0]);

  // 解析数据行
  const parsedRows = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseTableLine(lines[i]);
    // 只有当行的数据列数与表头列数一致时，才添加到结果中
    if (row.length === parsedHeaders.length) {
      parsedRows.push(row);
    }
  }

  console.log('解析结果:', { parsedHeaders, parsedRows });

  // 更新全局数据并渲染
  updateGlobalDataAndRender(parsedHeaders, parsedRows);
}

// 更新全局数据并调用原有渲染函数
function updateGlobalDataAndRender(newHeaders, newRows) {
  console.log('更新全局数据，表头数:', newHeaders.length, '数据行数:', newRows.length);

  // 更新全局变量
  headers = newHeaders;
  rows = newRows;

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

// 解析表格行的函数，处理不同格式的Markdown表格
function parseTableLine(line) {
  // 处理多种格式：| 列1 | 列2 | 或 列1 | 列2
  const trimmed = line.trim();
  const cells = [];

  // 方法1：如果以|开头和结尾，按|分割
  if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
    cells.push(...trimmed.slice(1, -1).split('|').map(c => c.trim()));
  }
  // 方法2：否则按|分割，但过滤空值
  else {
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

  // 生成列列表的HTML
  const html = headers.map((h, i) => {
    // 如果有搜索内容且列名不包含搜索内容，则跳过
    if (q && !h.toLowerCase().includes(q)) return '';
    // 检查该列是否被选中
    const on = activeCols.has(i);
    return `
      <div class="col-item" data-col-index="${i}" style="display:flex; align-items:center; padding:10px; border-radius:10px; margin-bottom:6px; cursor:pointer; background:${on ? 'rgba(96, 165, 250, 0.1)' : 'transparent'}; border:1px solid ${on ? 'var(--primary)' : 'var(--border)'}; transition:all 0.2s ease;">
        <div style="width:16px; height:16px; border-radius:4px; border:2px solid ${on ? 'var(--primary)' : 'var(--border)'}; margin-right:12px; display:flex; align-items:center; justify-content:center; background:${on ? 'var(--primary)' : 'transparent'}; transition:all 0.2s ease;">
          ${on ? '✓' : ''}
        </div>
        <span style="font-size:13px; color:${on ? 'var(--primary)' : 'var(--text)'}; font-weight:${on ? '600' : '400'}">${h}</span>
      </div>
    `;
  }).join('');

  colListDiv.innerHTML = html;

  // 绑定列选择事件
  const colItems = colListDiv.querySelectorAll('.col-item');
  colItems.forEach(item => {
    const colIndex = parseInt(item.getAttribute('data-col-index'));
    item.addEventListener('click', () => toggleCol(colIndex));
  });
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
  // 获取行搜索框的查询内容
  const q = document.getElementById('rowSearch').value.toLowerCase();
  // 获取当前激活的列索引数组并排序
  const activeIdxs = Array.from(activeCols).sort((a, b) => a - b);

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
    return `
      <th class="${sortClass}" data-sort-index="${i}">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <span style="flex: 1;">${headers[i]}</span>
          <button class="copy-header-btn" data-header="${headers[i]}" style="margin-left: 8px; border: none; background: none; cursor: pointer; opacity: 0.5; padding: 2px; width: 16px; height: 16px;" title="复制字段">
            <svg t="1766735305456" class="copy-icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
              <path d="M96.1 575.7a32.2 32.1 0 1 0 64.4 0 32.2 32.1 0 1 0-64.4 0Z" fill="currentColor" p-id="2498"></path>
              <path d="M742.1 450.7l-269.5-2.1c-14.3-0.1-26 13.8-26 31s11.7 31.3 26 31.4l269.5 2.1c14.3 0.1 26-13.8 26-31s-11.7-31.3-26-31.4zM742.1 577.7l-269.5-2.1c-14.3-0.1-26 13.8-26 31s11.7 31.3 26 31.4l269.5 2.1c14.3 0.2 26-13.8 26-31s-11.7-31.3-26-31.4z" fill="currentColor" p-id="2499"></path>
              <path d="M736.1 63.9H417c-70.4 0-128 57.6-128 128h-64.9c-70.4 0-128 57.6-128 128v128c-0.1 17.7 14.4 32 32.2 32 17.8 0 32.2-14.4 32.2-32.1V320c0-35.2 28.8-64 64-64H289v447.8c0 70.4 57.6 128 128 128h255.1c-0.1 35.2-28.8 63.8-64 63.8H224.5c-35.2 0-64-28.8-64-64V703.5c0-17.7-14.4-32.1-32.2-32.1-17.8 0-32.3 14.4-32.3 32.1v128.3c0 70.4 57.6 128 128 128h384.1c70.4 0 128-57.6 128-128h65c70.4 0 128-57.6 128-128V255.9l-193-192z m0.1 63.4l127.7 128.3H800c-35.2 0-64-28.8-64-64v-64.3h0.2z m64 641H416.1c-35.2 0-64-28.8-64-64v-513c0-35.2 28.8-64 64-64H671V191c0 70.4 57.6 128 128 128h65.2v385.3c0 35.2-28.8 64-64 64z" fill="currentColor" p-id="2500"></path>
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
    return r.some((cell, idx) => {
      // 只检查活跃列
      if (!activeCols.has(idx)) return false;
      const cellText = cell ? String(cell).toLowerCase() : '';
      return cellText.includes(q);
    });
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
        return `<td data-json="${htmlEscapeAttr(cell)}" style="position:relative;">${cellContent}</td>`;
      } catch (e) {
        // 不是有效JSON，按普通文本处理
      }
    }

    // 普通文本
    return `<td style="position:relative;">
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



// 绑定单元格点击事件
function bindCellClickEvents() {
  const tbody = document.getElementById('tbody');
  if (!tbody) return;

  // 移除之前的事件监听器，避免重复绑定
  tbody.removeEventListener('click', handleCellClick);

  // 添加新的事件监听器
  tbody.addEventListener('click', handleCellClick);

  // 处理单元格点击事件的内部函数
  function handleCellClick(e) {
    // 查找最近的td元素
    const cell = e.target.closest('td');
    if (!cell) return;

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

  // 为已有的单元格添加样式指示
  const cells = tbody.querySelectorAll('td');
  cells.forEach(cell => {
    if (!cell.hasAttribute('data-json')) {
      cell.style.cursor = 'pointer';
      cell.title = '点击复制';
    } else {
      cell.style.cursor = 'pointer';
      cell.title = '点击查看JSON详情';
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

// 转义HTML特殊字符
function escapeHtml(text) {
  // 创建一个临时div元素
  const div = document.createElement('div');
  // 设置textContent会自动转义HTML特殊字符
  div.textContent = text;
  // 返回转义后的HTML内容
  return div.innerHTML;
}

// 显示版本信息模态框
function showVersion() {
  document.getElementById('versionOverlay').style.display = 'flex';
}

// 关闭版本信息模态框
function closeVersionModal() {
  document.getElementById('versionOverlay').style.display = 'none';
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

