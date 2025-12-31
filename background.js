// 安装扩展时创建右键菜单
chrome.runtime.onInstalled.addListener(() => {
  console.log('扩展安装/更新，创建右键菜单');
  createContextMenu();
});

// 确保每次扩展加载时都检查并创建菜单项
chrome.runtime.onStartup.addListener(() => {
  console.log('扩展启动，检查右键菜单');
  createContextMenu();
});

// 创建右键菜单的函数
function createContextMenu() {
  // 先尝试删除可能已存在的菜单项，避免重复创建错误
  chrome.contextMenus.remove("parse-markdown-table", () => {
    // 忽略删除错误（如果菜单项不存在）
    if (chrome.runtime.lastError) {
      // 如果删除失败，可能是菜单项不存在，这没关系
      console.log('菜单项可能不存在，将继续创建:', chrome.runtime.lastError.message);
    }

    // 创建右键菜单项，用于解析选中的Markdown表格
    chrome.contextMenus.create({
      // 菜单项唯一标识符
      id: "parse-markdown-table",
      // 菜单项显示的标题
      title: "Markdown解析为表格",
      // 菜单项显示的上下文（选中文本时显示）
      contexts: ["selection"]
    }, () => {
      // 检查是否有错误
      if (chrome.runtime.lastError) {
        console.error('创建右键菜单失败:', chrome.runtime.lastError);
      } else {
        console.log('右键菜单创建成功');
      }
    });
  });
}

// 处理右键菜单点击事件
chrome.contextMenus.onClicked.addListener((info, tab) => {
  console.log('右键菜单被点击，菜单项ID:', info.menuItemId);

  // 检查点击的是否为Markdown表格解析菜单项
  if (info.menuItemId === "parse-markdown-table") {
    // 验证标签页信息是否有效
    if (!tab || !tab.id) {
      console.error('无法获取当前标签页信息');
      return;
    }

    console.log('有选中文本，准备获取带格式的文本');

    // 使用 executeScript 获取带格式的选中文本
    chrome.scripting.executeScript({
      // 指定目标标签页
      target: { tabId: tab.id },
      // 要在网页上下文中执行的函数
      function: getSelectedTextWithFormatting
    }, (results) => {
      // 检查执行脚本是否出错
      if (chrome.runtime.lastError) {
        console.error('执行脚本失败:', chrome.runtime.lastError);
        // 如果executeScript失败，尝试使用info.selectionText
        handleSelectedText(info.selectionText || '', tab);
        return;
      }

      // 检查脚本执行结果
      if (results && results[0] && results[0].result) {
        const selectedText = results[0].result;
        handleSelectedText(selectedText, tab);
      } else {
        console.log('没有获取到选中文本，使用info.selectionText');
        handleSelectedText(info.selectionText || '', tab);
      }
    });
  }
});

// 获取带格式的选中文本的函数（将在网页上下文中执行）
function getSelectedTextWithFormatting() {
  try {
    // 获取当前页面的选中内容
    const selection = window.getSelection();
    // 检查是否有选中内容
    if (!selection || selection.rangeCount === 0) {
      return '';
    }

    // 获取选中内容的范围
    const range = selection.getRangeAt(0);
    // 创建一个临时div来保存选中内容的副本
    const div = document.createElement('div');
    div.appendChild(range.cloneContents());

    // 获取带换行符的文本
    let selectedText = '';

    // 检查是否包含pre或code标签（这些标签通常包含格式化文本）
    const preElements = div.querySelectorAll('pre, code, textarea');
    if (preElements.length > 0) {
      // 使用textContent保留所有格式
      selectedText = Array.from(preElements)
        .map(el => el.textContent)
        .join('\n');
    } else {
      // 普通文本，使用innerText保留换行
      selectedText = div.innerText || range.toString();
    }

    // 如果innerText为空，回退到toString
    if (!selectedText.trim()) {
      selectedText = selection.toString();
    }

    return selectedText;
  } catch (error) {
    console.error('获取选中文本时出错:', error);
    return window.getSelection().toString();
  }
}

// 处理选中的文本
function handleSelectedText(selectedText, tab) {
  console.log('获取到的选中文本:', selectedText);
  console.log('文本长度:', selectedText.length);
  console.log('包含换行符:', selectedText.includes('\n'));
  console.log('前100字符:', selectedText.substring(0, 100));

  // 检查选中文本是否为空
  if (!selectedText || selectedText.trim().length === 0) {
    console.log('选中文本为空');
    return;
  }

  // 存储选中的文本到本地存储
  chrome.storage.local.set({
    // 存储Markdown文本内容
    markdownText: selectedText,
    // 设置自动解析标志为true
    autoParse: true
  }, () => {
    // 检查存储操作是否出错
    if (chrome.runtime.lastError) {
      console.error('存储失败:', chrome.runtime.lastError);
      return;
    }

    console.log('数据已保存到storage，文本长度:', selectedText.length);

    // 创建新标签页打开工具页面，紧邻当前标签页
    chrome.tabs.create({
      // 获取工具页面的URL
      url: chrome.runtime.getURL("tool/index.html"),
      // 设置新标签页为活动状态
      active: true,
      // 在当前标签页的右侧创建新标签页
      index: tab ? tab.index + 1 : undefined
    });
  });
}

// 处理工具栏图标点击事件（直接打开工具页面）
chrome.action.onClicked.addListener((tab) => {
  console.log('工具栏图标被点击');

  // 设置自动解析标志为false（不自动解析）
  chrome.storage.local.set({
    autoParse: false
  }, () => {
    // 创建新标签页打开工具页面
    chrome.tabs.create({
      // 获取工具页面的URL
      url: chrome.runtime.getURL("tool/index.html"),
      // 设置新标签页为活动状态
      active: true
    });
  });
});

console.log('background.js已加载');