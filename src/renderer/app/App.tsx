// Оболочка главного окна: боковая навигация из семи разделов + текущая страница.
// Страницы живут в pages/<Section>/ и заполняются своими тасками; этот файл дальше не меняется.
import type { ComponentType } from 'react';
import AnalyticsPage from './pages/Analytics/AnalyticsPage';
import BlockerPage from './pages/Blocker/BlockerPage';
import HomePage from './pages/Home/HomePage';
import SettingsPage from './pages/Settings/SettingsPage';
import SoundsPage from './pages/Sounds/SoundsPage';
import TasksPage from './pages/Tasks/TasksPage';
import TimerPage from './pages/Timer/TimerPage';
import { useRoute, type PageProps, type Section } from './routes';
import { Sidebar } from './shell/Sidebar';

const PAGES: Record<Section, ComponentType<PageProps>> = {
  home: HomePage,
  timer: TimerPage,
  sounds: SoundsPage,
  blocker: BlockerPage,
  tasks: TasksPage,
  analytics: AnalyticsPage,
  settings: SettingsPage,
};

export function App() {
  const [route, navigate] = useRoute();
  const Page = PAGES[route.section];
  return (
    <div className="flex h-full bg-bg text-fg">
      <Sidebar active={route.section} onSelect={(s) => navigate(s)} />
      <main className="min-w-0 flex-1 overflow-y-auto" data-page={route.section}>
        <div className="mx-auto max-w-5xl px-10 py-8">
          <Page sub={route.sub} navigate={navigate} />
        </div>
      </main>
    </div>
  );
}
