import stories from './components-system-notification.json';
import { story } from './story.js';

export default { title: "Components/System notification" };

export const SystemNotification = { name: "System notification", ...story(stories.SystemNotification) };
