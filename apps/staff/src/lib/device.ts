import type { DeviceType } from '@tavolina/shared';

const KEY = 'tavolina.deviceId';

/** A stable id for this browser, sent on login so the API can register the device. */
export function deviceInfo(): { uuid: string; name: string; type: DeviceType } {
  let uuid: string;
  try {
    uuid = localStorage.getItem(KEY) ?? crypto.randomUUID();
    localStorage.setItem(KEY, uuid);
  } catch {
    uuid = crypto.randomUUID();
  }
  const touch = navigator.maxTouchPoints > 0;
  const name = touch ? 'Tablet / phone' : 'Computer';
  return { uuid, name, type: 'pos' };
}
