/*
 * @Description: 
 * @LastEditors: 他们叫我跃总 Dec27-Lee
 * @Date: 2025-12-26 08:45:05
 * @LastEditTime: 2025-12-26 09:14:35
 * @FilePath: \Markdown-to-Table\content.js
 */
// content.js - 内容脚本
// 这里可以添加与网页交互的功能
console.log("Markdown表格解析器内容脚本已加载");

// 监听来自background或popup的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 检查消息动作是否为获取页面选择内容
  if (message.action === "getSelection") {
    // 获取页面当前选择的文本内容
    const selection = window.getSelection();
    // 向发送方响应选择的文本内容
    sendResponse({
      text: selection.toString(),
      success: true
    });
  }
  // 返回true以保持消息通道开启，允许异步发送响应
  return true;
});