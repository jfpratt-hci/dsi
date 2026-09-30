import { Share } from 'react-native';

export const SEEN_WELCOME = 'dsi.seenWelcome';

export function inviteCrew(name?: string | null) {
  return Share.share({ message: `${name ? name + ' wants you on' : 'Get on'} the Dandy Strength Index. Your bench, squat, deadlift and clean scored against lifters your age and size. Join free: https://dandystrength.com/join` }).catch(() => {});
}
