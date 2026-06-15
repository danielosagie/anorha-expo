// The chat composer now lives in src/components/chat/MessageComposer.tsx so it can be reused
// anywhere (e.g. the Generate Details "wanna change something" tray). This thin re-export keeps
// the chat's existing import path working with identical behavior.
export { MessageComposer as ConversationComposer } from '../../../components/chat/MessageComposer';
