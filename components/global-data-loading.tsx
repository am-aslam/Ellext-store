'use client';

import { useEffect, useState } from 'react';
import { subscribeToDataLoading } from '@/lib/data-fetch';
import { LoadingAnimation } from '@/components/loading-animation';

export function GlobalDataLoading() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let timer: number | undefined;
    let isVisible = false;
    const unsubscribe = subscribeToDataLoading(count => {
      if (count > 0) {
        if (!isVisible && timer === undefined) {
          timer = window.setTimeout(() => {
            isVisible = true;
            timer = undefined;
            setVisible(true);
          }, 180);
        }
        return;
      }

      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      isVisible = false;
      setVisible(false);
    });

    return () => {
      unsubscribe();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  if (!visible) return null;
  return <div className="global-data-loading" aria-live="polite"><LoadingAnimation label="Loading data" /></div>;
}
