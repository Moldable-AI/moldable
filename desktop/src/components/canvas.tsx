import type { AppConfig } from '../app'
import { EmptyStateApps } from './empty-state-apps'
import { WidgetCard } from './widget-card'
import { motion } from 'framer-motion'

interface CanvasProps {
  apps: AppConfig[]
  workspaceId: string
  onOpenApp: (app: AppConfig) => void
  onAddApp: () => void
  onRefreshApps?: () => void
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 8, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.3,
      ease: 'easeOut' as const,
    },
  },
}

// Grid classes need to be on the grid item (motion.div), not nested inside
// All widgets are the same size on the grid
const WIDGET_GRID_CLASSES = {
  small: 'col-span-1 row-span-1',
  medium: 'col-span-1 row-span-1',
  large: 'col-span-1 row-span-1',
}

export function Canvas({
  apps,
  workspaceId,
  onOpenApp,
  onAddApp,
  onRefreshApps,
}: CanvasProps) {
  if (apps.length === 0) {
    return <EmptyStateApps onAddApp={onAddApp} onRefreshApps={onRefreshApps} />
  }

  return (
    <div className="pb-(--chat-safe-padding) h-full overflow-auto p-6">
      {/* Widget grid */}
      <motion.div
        className="grid auto-rows-auto grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {apps.map((app) => (
          <motion.div
            key={app.id}
            variants={itemVariants}
            initial="hidden"
            animate="visible"
            className={WIDGET_GRID_CLASSES[app.widgetSize]}
          >
            <WidgetCard
              app={app}
              workspaceId={workspaceId}
              onClick={() => onOpenApp(app)}
            />
          </motion.div>
        ))}
      </motion.div>
    </div>
  )
}
