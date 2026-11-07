import './globals.css'
import styles from './page.module.css'
import { PopoverDemo } from './popover-demo'

export default function Page() {
  return (
    <main className="p-8">
      <h1 className={`${styles.title} text-2xl font-bold`}>Next 16 fixture</h1>
      <PopoverDemo />
    </main>
  )
}
