import stories from './components-find-in-the-conversation.json';
import { story } from './story.js';

export default { title: "Components/Find in the conversation" };

export const FindInTheConversation = { name: "Find in the conversation", ...story(stories.FindInTheConversation) };
