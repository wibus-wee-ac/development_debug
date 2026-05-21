# language: zh-CN

@cradle
功能: 全局搜索中的线程搜索
  作为用户，我希望通过真实的全局搜索入口按标题或消息内容定位会话，并直接打开对应会话

  背景:
    假如 应用已启动

  @P1 @CRADLE-SEARCH-001
  场景: 按会话标题搜索时显示标题高亮并打开对应会话
    假如 我已配置 Mock LLM Provider
    而且 我已添加了一个工作区
    当 我新建一个聊天会话并记住为"标题目标会话"，首条消息为"titlesearchtarget20260506 session"
    而且 我新建一个聊天会话并记住为"当前会话"，首条消息为"other session before search"
    而且 我打开全局搜索对话框
    而且 我在全局搜索中输入"titlesearchtarget20260506"
    那么 全局搜索中应该显示会话"标题目标会话"的标题高亮"titlesearchtarget20260506"
    当 我从全局搜索打开会话"标题目标会话"
    那么 当前聊天视图应该打开会话"标题目标会话"

  @P1 @CRADLE-SEARCH-002
  场景: 按消息内容搜索时显示高亮片段并打开对应会话
    假如 我已配置 Mock LLM Provider
    而且 我已添加了一个工作区
    当 我新建一个聊天会话并记住为"内容目标会话"，首条消息为"plain title for snippet journey"
    而且 我在聊天输入框中输入"snippettarget20260506 message body"
    而且 我点击聊天发送按钮
    那么 最后一条 AI 消息应包含"Hello from mock LLM!"
    而且 我新建一个聊天会话并记住为"当前会话"，首条消息为"other session after snippet"
    当 我打开全局搜索对话框
    而且 我在全局搜索中输入"snippettarget20260506"
    那么 全局搜索中应该显示会话"内容目标会话"的消息片段高亮"snippettarget20260506"
    当 我从全局搜索打开会话"内容目标会话"
    那么 当前聊天视图应该打开会话"内容目标会话"
