import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getDatabase, ref, push, set, get, update, remove, onValue, off
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { FIREBASE_CONFIG } from './firebase-config.js';

const app = initializeApp(FIREBASE_CONFIG);
const db = getDatabase(app);

/* ---------- утилиты ---------- */
export function hashPass(p) {
  let h = 5381;
  for (let i = 0; i < p.length; i++) { h = ((h << 5) + h) + p.charCodeAt(i); h |= 0; }
  return 'h' + Math.abs(h).toString(36) + '_' + p.length;
}

const BAD = ["хуй","хуя","хую","хуе","хуё","хуи","пизд","бляд","блядь","блять","блят",
"ебат","ебал","ебёт","ебет","ебуч","ебан","ебну","сука","суки","сучк","сучар",
"мудак","мудил","мудозвон","пидор","пидар","пидр","гандон","гондон","долбоёб","долбоеб",
"залуп","мразь","мрази","шлюх","нахуй","нахуя","нахуе","охуе","охуи","охуя",
"похуй","похуя","ахуе","ахуи","заеб","заёб","отъеб","отъёб","приеб","приёб",
"уёб","уеб","въеб","въёб","выеб","выёб","разъеб","разъёб","пиздец","пизда","пизду"];
const BAD_RE = BAD.map(w => new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));

export function clean(t) {
  if (!t) return '';
  let s = String(t);
  BAD_RE.forEach(rx => { s = s.replace(rx, '***'); });
  return s;
}

/* ---------- пользователи ---------- */
export async function registerUser(data) {
  const snap = await get(ref(db, 'users'));
  const users = snap.val() || {};
  const list = Object.values(users);

  if (list.some(u => u.username === data.username.toLowerCase()))
    throw new Error('Логин уже занят');
  if (list.some(u => u.email === data.email.toLowerCase()))
    throw new Error('Почта уже используется');

  const userRef = push(ref(db, 'users'));
  const id = userRef.key;
  const user = {
    id,
    username: data.username.toLowerCase(),
    email: data.email.toLowerCase(),
    passwordHash: hashPass(data.password),
    firstName: data.firstName,
    lastName: data.lastName,
    canTeach: clean(data.canTeach),
    wantsLearn: clean(data.wantsLearn),
    bio: clean(data.bio || ''),
    coins: 0,
    createdAt: Date.now()
  };
  await set(userRef, user);
  return user;
}

export async function loginUser(username, password) {
  const snap = await get(ref(db, 'users'));
  const users = Object.values(snap.val() || {});
  const user = users.find(u => u.username === username.toLowerCase());
  if (!user || user.passwordHash !== hashPass(password))
    throw new Error('Неверный логин или пароль');
  return user;
}

export function watchUser(userId, cb) {
  return onValue(ref(db, 'users/' + userId), snap => cb(snap.val()));
}

export async function getUser(userId) {
  const snap = await get(ref(db, 'users/' + userId));
  return snap.val();
}

export async function getAllUsers() {
  const snap = await get(ref(db, 'users'));
  return Object.values(snap.val() || {});
}

/* ---------- объявления ---------- */
export async function createListing(data) {
  const listingRef = push(ref(db, 'listings'));
  const id = listingRef.key;
  const item = {
    id,
    authorId: data.authorId,
    title: clean(data.title),
    category: data.category,
    offer: clean(data.offer),
    want: clean(data.want),
    description: clean(data.description),
    createdAt: Date.now()
  };
  await set(listingRef, item);
  return item;
}

export function watchListings(cb) {
  return onValue(ref(db, 'listings'), snap => {
    const data = snap.val() || {};
    const list = Object.values(data).sort((a, b) => b.createdAt - a.createdAt);
    cb(list);
  });
}

export async function getListing(id) {
  const snap = await get(ref(db, 'listings/' + id));
  return snap.val();
}

export async function deleteListing(id) {
  await remove(ref(db, 'listings/' + id));
}

/* ---------- обмены ---------- */
export async function createExchange(listingId, initiatorId, ownerId, message) {
  const exRef = push(ref(db, 'exchanges'));
  const id = exRef.key;
  const ex = {
    id,
    listingId,
    initiatorId,
    ownerId,
    status: 'pending',
    initiatorVideo: null,
    ownerVideo: null,
    createdAt: Date.now(),
    acceptedAt: null,
    completedAt: null
  };
  await set(exRef, ex);

  if (message && message.trim()) {
    await sendMessage(id, initiatorId, message);
  }

  await createNotification(ownerId, 'exchange_request',
    'Новый запрос на обмен', id);

  return ex;
}

export async function checkExistingExchange(listingId, initiatorId) {
  const snap = await get(ref(db, 'exchanges'));
  const list = Object.values(snap.val() || {});
  return list.find(e => e.listingId === listingId && e.initiatorId === initiatorId
    && (e.status === 'pending' || e.status === 'accepted'));
}

export function watchExchanges(userId, cb) {
  return onValue(ref(db, 'exchanges'), snap => {
    const data = snap.val() || {};
    const list = Object.values(data)
      .filter(e => e.initiatorId === userId || e.ownerId === userId)
      .sort((a, b) => b.createdAt - a.createdAt);
    cb(list);
  });
}

export function watchExchange(id, cb) {
  return onValue(ref(db, 'exchanges/' + id), snap => cb(snap.val()));
}

export async function acceptExchange(id, ownerId) {
  const exSnap = await get(ref(db, 'exchanges/' + id));
  const ex = exSnap.val();
  if (!ex || ex.ownerId !== ownerId) throw new Error('Нет доступа');
  await update(ref(db, 'exchanges/' + id), { status: 'accepted', acceptedAt: Date.now() });
  await createNotification(ex.initiatorId, 'exchange_accepted',
    'Ваш запрос на обмен принят', id);
}

export async function rejectExchange(id, ownerId) {
  const exSnap = await get(ref(db, 'exchanges/' + id));
  const ex = exSnap.val();
  if (!ex || ex.ownerId !== ownerId) throw new Error('Нет доступа');
  await update(ref(db, 'exchanges/' + id), { status: 'rejected' });
  await createNotification(ex.initiatorId, 'exchange_rejected',
    'Ваш запрос на обмен отклонён', id);
}

export async function uploadVideo(exchangeId, userId, file) {
  if (file.size > 500 * 1024) throw new Error('Видео больше 500 КБ — выбери поменьше');
  const base64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => res(e.target.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  const exSnap = await get(ref(db, 'exchanges/' + exchangeId));
  const ex = exSnap.val();
  if (!ex || (ex.initiatorId !== userId && ex.ownerId !== userId))
    throw new Error('Нет доступа');
  if (ex.status !== 'accepted') throw new Error('Обмен не активен');

  const patch = {};
  if (userId === ex.initiatorId) patch.initiatorVideo = base64;
  else patch.ownerVideo = base64;

  const newInitiatorVideo = patch.initiatorVideo || ex.initiatorVideo;
  const newOwnerVideo = patch.ownerVideo || ex.ownerVideo;

  let completed = false;
  if (newInitiatorVideo && newOwnerVideo) {
    patch.status = 'completed';
    patch.completedAt = Date.now();
    completed = true;
  }

  await update(ref(db, 'exchanges/' + exchangeId), patch);

  if (completed) {
    for (const uid of [ex.initiatorId, ex.ownerId]) {
      const uSnap = await get(ref(db, 'users/' + uid));
      const u = uSnap.val();
      if (u) await update(ref(db, 'users/' + uid), { coins: (u.coins || 0) + 1 });
      await createNotification(uid, 'exchange_completed',
        'Обмен завершён. Начислен 1 Тайм-коин.', exchangeId);
    }
  }

  return { completed };
}

/* ---------- сообщения ---------- */
export async function sendMessage(exchangeId, senderId, text) {
  const clean_text = clean(text);
  if (!clean_text.trim()) throw new Error('Пустое сообщение');
  if (clean_text.length > 1000) throw new Error('Слишком длинное');

  const msgRef = push(ref(db, 'messages/' + exchangeId));
  await set(msgRef, {
    id: msgRef.key,
    senderId,
    text: clean_text,
    createdAt: Date.now()
  });
}

export function watchMessages(exchangeId, cb) {
  return onValue(ref(db, 'messages/' + exchangeId), snap => {
    const data = snap.val() || {};
    const list = Object.values(data).sort((a, b) => a.createdAt - b.createdAt);
    cb(list);
  });
}

/* ---------- уведомления ---------- */
export async function createNotification(userId, type, text, exchangeId) {
  const nRef = push(ref(db, 'notifications/' + userId));
  await set(nRef, {
    id: nRef.key,
    type,
    text,
    exchangeId: exchangeId || null,
    read: false,
    createdAt: Date.now()
  });
}

export function watchNotifications(userId, cb) {
  return onValue(ref(db, 'notifications/' + userId), snap => {
    const data = snap.val() || {};
    const list = Object.values(data).sort((a, b) => b.createdAt - a.createdAt);
    cb(list);
  });
}

export async function markNotificationsRead(userId) {
  const snap = await get(ref(db, 'notifications/' + userId));
  const data = snap.val() || {};
  const updates = {};
  Object.keys(data).forEach(k => { updates[k + '/read'] = true; });
  if (Object.keys(updates).length) {
    await update(ref(db, 'notifications/' + userId), updates);
  }
}