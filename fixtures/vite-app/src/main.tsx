import { CSSCoverageTracker } from 'css-coverage-tracker/react'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import adminStyles from './admin.module.css'
import styles from './app.module.css'
import './hmr.css'
import './index.css'

function usePath(): string {
  const [path, setPath] = useState(location.pathname)
  useEffect(() => {
    const update = () => setPath(location.pathname)
    addEventListener('popstate', update)
    addEventListener('app-navigate', update)
    return () => {
      removeEventListener('popstate', update)
      removeEventListener('app-navigate', update)
    }
  }, [])
  return path
}

function navigate(to: string): void {
  history.pushState({}, '', to)
  dispatchEvent(new Event('app-navigate'))
}

function Popover() {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        data-testid="trigger"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        Toggle
      </button>
      <div
        data-state={open ? 'open' : 'closed'}
        className="rounded-md border p-4 data-[state=closed]:hidden data-[state=open]:bg-sky-100"
      >
        Popover content
      </div>
    </div>
  )
}

function App() {
  const path = usePath()
  return (
    <main className={styles.page}>
      <nav>
        <a
          href="/"
          onClick={e => {
            e.preventDefault()
            navigate('/')
          }}
        >
          Home
        </a>{' '}
        <a
          href="/admin"
          data-testid="nav-admin"
          onClick={e => {
            e.preventDefault()
            navigate('/admin')
          }}
        >
          Admin
        </a>{' '}
        <button
          type="button"
          data-testid="dark"
          onClick={() => document.documentElement.classList.toggle('dark')}
        >
          Dark
        </button>
      </nav>
      {path === '/admin' ? (
        <section className={adminStyles.panel}>Admin</section>
      ) : (
        <section className={styles.hero}>
          <h1 className="hmr-keep text-2xl font-bold dark:text-white">Home</h1>
          <Popover />
        </section>
      )}
      <CSSCoverageTracker pathname={path} options={{ knownRoutes: ['/', '/admin'] }} />
    </main>
  )
}

const root = document.getElementById('root')
if (root)
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
