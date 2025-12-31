// 表格高度自适应功能
document.addEventListener('DOMContentLoaded', function () {
  console.log('开始初始化表格高度自适应功能');

  // 延迟执行以确保DOM完全加载
  setTimeout(function () {
    const textarea = document.getElementById('rawInput');
    const textareaContainer = document.querySelector('.textarea-container');
    const tableScrollContainer = document.querySelector('.table-scroll-container');
    const inputBar = document.querySelector('.input-bar');
    const sqlDisplayContainer = document.querySelector('.sql-display-container');
    const searchBar = document.querySelector('.search-bar-container');

    console.log('元素获取结果:', {
      textarea: !!textarea,
      tableScrollContainer: !!tableScrollContainer,
      inputBar: !!inputBar,
      sqlDisplayContainer: !!sqlDisplayContainer,
      searchBar: !!searchBar
    });

    if (textarea && tableScrollContainer && inputBar) {
      let lastTextareaHeight = 0;

      // 更新表格容器高度的函数
      function updateTableContainerHeight() {
        try {
          // 获取输入区域的总高度（包括textarea容器、内边距等）
          const inputBarRect = inputBar.getBoundingClientRect();
          const inputBarHeight = inputBarRect.height;

          // 计算已使用高度
          let usedHeight = inputBarHeight;

          // 如果SQL显示区域存在且可见，加上其高度
          if (sqlDisplayContainer && sqlDisplayContainer.style.display !== 'none') {
            const sqlHeight = sqlDisplayContainer.getBoundingClientRect().height;
            usedHeight += sqlHeight;
            console.log('SQL显示区域高度:', sqlHeight);
          } else {
            console.log('SQL显示区域不存在或不可见');
          }

          // 添加搜索栏和字段选择器的高度
          if (searchBar) {
            const searchHeight = searchBar.getBoundingClientRect().height;
            usedHeight += searchHeight;
            console.log('搜索栏高度:', searchHeight);
          }

          // 预留一些边距和内边距
          const marginHeight = 60; // 增加预留边距

          // 计算表格容器的可用高度
          const availableHeight = window.innerHeight - usedHeight - marginHeight;

          // 设置表格容器的最大高度，确保至少有100px高度
          const minHeight = 100;
          const finalHeight = Math.max(availableHeight, minHeight);

          // 使用 !important 确保样式优先级更高
          tableScrollContainer.style.setProperty('max-height', finalHeight + 'px', 'important');

          console.log('更新表格容器高度:', finalHeight + 'px', '可用高度:', availableHeight, '已用高度:', usedHeight, '窗口高度:', window.innerHeight);
        } catch (error) {
          console.error('更新表格容器高度时出错:', error);
        }
      }

      // 使用MutationObserver作为备选方案来监听textarea样式变化
      if (window.MutationObserver) {
        const observer = new MutationObserver(function (mutations) {
          console.log('MutationObserver触发');
          mutations.forEach(function (mutation) {
            if (mutation.type === 'attributes' &&
              (mutation.attributeName === 'style' || mutation.attributeName === 'class')) {
              const currentHeight = textarea.offsetHeight;
              if (Math.abs(currentHeight - lastTextareaHeight) > 5) { // 高度变化超过5px时更新
                console.log('检测到textarea高度变化:', lastTextareaHeight, '->', currentHeight);
                lastTextareaHeight = currentHeight;
                setTimeout(updateTableContainerHeight, 50); // 延迟执行，避免频繁调用
              }
            }
          });
        });

        observer.observe(textarea, {
          attributes: true,
          attributeFilter: ['style', 'class']
        });

        console.log('MutationObserver已设置');
      }

      // 窗口大小改变时重新计算
      window.addEventListener('resize', function () {
        console.log('窗口大小改变事件触发');
        updateTableContainerHeight();
      });

      // 监听textarea的input和change事件
      ['input', 'change'].forEach(function (event) {
        textarea.addEventListener(event, function () {
          console.log('Textarea', event, '事件触发');
          setTimeout(updateTableContainerHeight, 100); // 稍微延迟以确保DOM更新
        });
      });

      // 监听textarea的mouseup事件（当用户拖拽调整大小后释放鼠标时）
      textarea.addEventListener('mouseup', function () {
        console.log('Textarea mouseup 事件触发');
        setTimeout(updateTableContainerHeight, 50);
      });

      // 监听textarea的focus事件，确保在某些情况下也能正确更新
      textarea.addEventListener('focus', function () {
        console.log('Textarea focus 事件触发');
        setTimeout(updateTableContainerHeight, 100);
      });

      // 定期检查高度变化（作为最后的保障）
      setInterval(function () {
        const currentHeight = textarea.offsetHeight;
        if (Math.abs(currentHeight - lastTextareaHeight) > 5) {
          console.log('定时检查发现高度变化:', lastTextareaHeight, '->', currentHeight);
          lastTextareaHeight = currentHeight;
          updateTableContainerHeight();
        }
      }, 300); // 每300ms检查一次

      // 初始化表格容器高度
      console.log('初始化表格容器高度');
      setTimeout(updateTableContainerHeight, 100); // 稍微延迟以确保页面完全加载
    } else {
      console.error('未找到必要的DOM元素:', {
        textarea: !!textarea,
        tableScrollContainer: !!tableScrollContainer,
        inputBar: !!inputBar,
        sqlDisplayContainer: !!sqlDisplayContainer,
        searchBar: !!searchBar
      });
    }
  }, 200); // 延迟200ms确保DOM完全加载
});