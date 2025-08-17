"use client";

import styles from "./index.module.scss";

export default function NavBar() {
  return (
    <nav className={styles.nav} aria-label="主导航">
      <div className={styles.brand}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 2l3.5 6.99L23 10l-5.5 4.26L19 21l-7-3.67L5 21l1.5-6.74L1 10l7.5-1.01L12 2z"/>
        </svg>
        <span className={styles.brandTitle}>AI中文文本检测</span>
      </div>
      <div className={styles.actions}>
        {/* 预留操作区 */}
      </div>
    </nav>
  );
}
