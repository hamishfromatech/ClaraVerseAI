/**
 * Utility functions for generating dynamic greetings based on time of day
 */

// Store/retrieve user name from localStorage
const USER_NAME_KEY = 'atech_user_name';

// Helper function to get user-specific storage key
function getUserSpecificKey(): string {
  try {
    const authStorage = localStorage.getItem('auth-storage');
    if (authStorage) {
      const { state } = JSON.parse(authStorage);
      if (state?.user?.id) {
        return `${USER_NAME_KEY}-${state.user.id}`;
      }
    }
  } catch (error) {
    console.warn('Failed to get user ID for user name key:', error);
  }
  return USER_NAME_KEY;
}

export function getUserName(): string | null {
  const key = getUserSpecificKey();
  return localStorage.getItem(key);
}

export function setUserName(name: string): void {
  const key = getUserSpecificKey();
  localStorage.setItem(key, name.trim());
}

export function hasUserName(): boolean {
  return !!getUserName();
}

// Get current time period
type TimePeriod =
  | 'early_morning'
  | 'morning'
  | 'late_morning'
  | 'afternoon'
  | 'evening'
  | 'night'
  | 'late_night';

function getTimePeriod(): TimePeriod {
  const hour = new Date().getHours();

  if (hour >= 0 && hour < 5) return 'late_night';
  if (hour >= 5 && hour < 8) return 'early_morning';
  if (hour >= 8 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 14) return 'late_morning';
  if (hour >= 14 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

// Get day of week
function getDayOfWeek(): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[new Date().getDay()];
}

// Greeting templates by time period
const greetingTemplates: Record<TimePeriod, string[]> = {
  early_morning: [
    'Good morning, {name}! Early bird gets the worm',
    'Rise and shine, {name}!',
    'Morning, {name}! Ready to seize the day?',
    "Hey {name}, you're up early! Coffee time?",
  ],
  morning: [
    'Good morning, {name}!',
    'Morning, {name}! Ready to tackle {day}?',
    'Hey {name}! Did you have your coffee yet?',
    "Happy {day}, {name}! Let's make it productive",
    'Morning vibes, {name}! What are we building today?',
  ],
  late_morning: [
    'Hey {name}! Mid-morning productivity?',
    "Hi {name}! How's your {day} going so far?",
    'Hello {name}! Pre-lunch creativity time?',
    "What's up, {name}? Almost lunch time!",
  ],
  afternoon: [
    'Good afternoon, {name}!',
    "Hey {name}! Post-lunch energy? Let's go!",
    "Afternoon, {name}! How's {day} treating you?",
    'Hi {name}! Midday creativity boost?',
    "What's cooking, {name}?",
  ],
  evening: [
    'Good evening, {name}!',
    'Hey {name}! Winding down or second wind?',
    'Evening, {name}! Still going strong?',
    'Hi {name}! Golden hour productivity?',
    "What's up, {name}? Dinner done?",
  ],
  night: [
    'Good evening, {name}!',
    'Hey {name}! Night owl mode activated?',
    'Late {day} vibes, {name}! Still grinding?',
    "What's up, {name}? Burning the midnight oil?",
    'Evening, {name}! Second shift energy?',
  ],
  late_night: [
    'Whoa, {name}! Night owl, huh?',
    "Hey {name}! Can't sleep or still working?",
    'Late night energy, {name}! You got this',
    'Burning the midnight oil, {name}?',
    "Still up, {name}? Let's make it count!",
  ],
};

/**
 * Generate a dynamic greeting based on current time and user name
 */
export function generateGreeting(): string {
  const name = getUserName();
  const timePeriod = getTimePeriod();
  const day = getDayOfWeek();

  // Get random greeting template for current time period
  const templates = greetingTemplates[timePeriod];
  const template = templates[Math.floor(Math.random() * templates.length)];

  // Replace placeholders
  const greeting = template.replace('{name}', name || 'there').replace('{day}', day);

  return greeting;
}

/**
 * Generate greeting without name (for first-time users before they set name)
 */
export function generateAnonymousGreeting(): string {
  const timePeriod = getTimePeriod();

  const anonymousGreetings: Record<TimePeriod, string[]> = {
    early_morning: ['Good morning! Early bird, huh?', 'Rise and shine! Ready to start the day?'],
    morning: ['Good morning!', "Happy {day}! Let's make it count", 'Morning! Coffee first?'],
    late_morning: ["Hey there! How's your morning going?", 'Hi! Mid-morning productivity?'],
    afternoon: ['Good afternoon!', 'Hey! Post-lunch energy?', 'Afternoon vibes! How can I help?'],
    evening: ['Good evening!', 'Evening! Still going strong?', 'Hey! Winding down or second wind?'],
    night: ['Good evening!', 'Night owl mode?', "Late {day} vibes! What's up?"],
    late_night: [
      'Whoa! Night owl, huh?',
      "Still up? Let's make it count!",
      'Burning the midnight oil?',
    ],
  };

  const templates = anonymousGreetings[timePeriod];
  const template = templates[Math.floor(Math.random() * templates.length)];
  const day = getDayOfWeek();

  return template.replace('{day}', day);
}
