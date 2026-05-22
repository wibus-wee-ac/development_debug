// Output: Shared lazy loader and preload hook for the chat session view.
// Input: Route preload intent from session links, search results, and tray actions.
// Position: Owned by chat so tab registration can defer chat rendering without eager implementation imports.

export function loadChatView() {
  return import('~/features/chat/chat-view').then(module => ({ default: module.ChatView }))
}

export function preloadChatView(): void {
  void loadChatView()
}
