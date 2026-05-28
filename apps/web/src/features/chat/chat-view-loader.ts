// Output: Shared lazy loader and preload hook for the chat session view.
// Input: Route preload intent from session links, search results, and tray actions.
// Position: Owned by chat so tab registration can defer chat rendering without eager implementation imports.

import { ChatView } from './chat-view'

export function loadChatView() {
  return Promise.resolve({ default: ChatView })
}

export function preloadChatView(): void {
  void loadChatView()
}
