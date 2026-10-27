import type { Messages } from '../ru';

export const updates: Messages['updates'] = {
  title: 'Updates',
  check: 'Check for updates',
  checking: 'Checking…',
  download: 'Download version {version}',
  upToDate: 'You have the latest version.',
  available: 'Version {version} is available. Download it with the button; it installs when you quit the app.',
  downloaded: 'Version {version} is downloaded and will be installed when you quit the app.',
  notConfigured: 'Update source is not configured: the GitHub owner and repository are not set.',
  devBuild: 'Updates work only in the installed app.',
  downloading: 'Downloading the update…',
  error: 'Could not check for updates. See the log for details.',
};
