# language: zh-CN

@cradle
功能: 资源诊断弹层
  作为用户，我希望从应用 Header 查看 renderer、server、terminal 和 Chronicle 的资源占用，并能手动刷新诊断数据

  背景:
    假如 应用已启动

  @P1 @CRADLE-RESOURCES-001
  场景: 打开 Header Resources 弹层并刷新诊断数据
    当 我打开资源诊断弹层
    那么 资源诊断弹层应显示核心资源分组
    当 我刷新资源诊断弹层
    那么 资源诊断弹层应显示核心资源分组
