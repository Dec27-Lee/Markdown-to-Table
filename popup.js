/*
 * @Description: 
 * @LastEditors: 他们叫我跃总 Dec27-Lee
 * @Date: 2025-12-25 14:46:26
 * @LastEditTime: 2025-12-25 14:46:35
 * @FilePath: \Dec27-Lee.github.iof:\Develop_F\markdown-table-extension\popup.js
 */

// 获取打开工具按钮并添加点击事件监听器
document.getElementById('openTool').addEventListener('click', () => {
  // 创建新标签页打开工具页面
  chrome.tabs.create({
    // 获取工具页面的URL路径
    url: chrome.runtime.getURL('tool/index.html')
  });

  // 可选：关闭popup窗口
  window.close();
});