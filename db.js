import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getDatabase, ref, push, set, get, update, onValue } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';
import { FIREBASE_CONFIG } from './firebase-config.js';

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getDatabase(app);

const BAD = ["хуй","хуя","хую","хуе","хуё","хуи","пизд","бляд","блядь","блять","блят","ебат","ебал","ебёт","ебет","ебуч","ебан","ебну","сука","суки","сучк","сучар","мудак","мудил","мудозвон","пидор","пидар","пидр","гандон","гондон","долбоёб","долбоеб","залуп","мразь","мрази","шлюх","нахуй","нахуя","нахуе","охуе","охуи","охуя","похуй","похуя","ахуе","ахуи","заеб","заёб","отъеб","отъёб","приеб","приёб","уёб","уеб","въеб","въёб","выеб","выёб","разъеб","разъёб","пиздец","пизда","пизду"];
const BAD_RE = BAD.map(w => new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));
export function clean(t){if(!t)return'';let s=String(t);BAD_RE.forEach(rx=>{s=s.replace(rx,'***')});return s}

export async function register(email, password, profile) {
  const snap = await get(ref(db, 'users'));
  const all = Object.values(snap.val() || {});
  const uname = profile.username.toLowerCase();
  if (all.some(u => u.username === uname)) throw new Error('Логин уже занят');
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;
  const user = {
    uid, email: email.toLowerCase(), username: uname,
    firstName: profile.firstName, lastName: profile.lastName,
    canTeach: clean(profile.canTeach), wantsLearn: clean(profile.wantsLearn),
    bio: clean(profile.bio || ''), coins: 0, createdAt: Date.now()
  };
  await set(ref(db, 'users/' + uid), user);
  user.id = uid;
  return user;
}

export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const snap = await get(ref(db, 'users/' + cred.user.uid));
  const profile = snap.val();
  if (!profile) throw new Error('Профиль не найден');
  profile.id = cred.user.uid;
  profile.uid = cred.user.uid;
  return profile;
}

export async function logout() { await signOut(auth); }
export async function resetPassword(email) { await sendPasswordResetEmail(auth, email); }

export function onAuthChange(cb) {
  return onAuthStateChanged(auth, async fbUser => {
    if (!fbUser) return cb(null);
    try {
      const snap = await get(ref(db, 'users/' + fbUser.uid));
      const profile = snap.val();
      if (profile) {
        profile.id = fbUser.uid;
        profile.uid = fbUser.uid;
        cb(profile);
      } else cb(null);
    } catch(e) { cb(null); }
  });
}

export async function getUser(uid) {
  const snap = await get(ref(db, 'users/' + uid));
  const d = snap.val();
  if (d) { d.id = uid; d.uid = uid; }
  return d;
}

export async function getAllUsers() {
  const snap = await get(ref(db, 'users'));
  const data = snap.val() || {};
  return Object.values(data).map(u => ({ ...u, id: u.uid || u.id }));
}

export function watchUser(uid, cb) {
  return onValue(ref(db, 'users/' + uid), snap => {
    const d = snap.val();
    if (d) { d.id = uid; d.uid = uid; }
    cb(d);
  });
}

export async function createListing(data) {
  const r = push(ref(db, 'listings'));
  const item = {
    id: r.key, authorId: data.authorId,
    title: clean(data.title), category: data.category,
    offer: clean(data.offer), want: clean(data.want),
    description: clean(data.description), createdAt: Date.now()
  };
  await set(r, item);
  return item;
}

export function watchListings(cb) {
  return onValue(ref(db, 'listings'), snap => {
    const data = snap.val() || {};
    cb(Object.values(data).sort((a, b) => b.createdAt - a.createdAt));
  });
}

export async function createExchange(listingId, initiatorId, ownerId, message) {
  const r = push(ref(db, 'exchanges'));
  const ex = {
    id: r.key, listingId, initiatorId, ownerId,
    status: 'pending', initiatorVideo: null, ownerVideo: null,
    initiatorReview: false, ownerReview: false,
    createdAt: Date.now(), acceptedAt: null, completedAt: null
  };
  await set(r, ex);
  if (message && message.trim()) await sendMessage(r.key, initiatorId, message);
  await createNotification(ownerId, 'exchange_request', 'Новый запрос на обмен', r.key);
  return ex;
}

export async function checkExistingExchange(listingId, initiatorId) {
  const snap = await get(ref(db, 'exchanges'));
  const list = Object.values(snap.val() || {});
  return list.find(e => e.listingId === listingId && e.initiatorId === initiatorId && (e.status === 'pending' || e.status === 'accepted'));
}

export function watchExchanges(userId, cb) {
  return onValue(ref(db, 'exchanges'), snap => {
    const data = snap.val() || {};
    cb(Object.values(data).filter(e => e.initiatorId === userId || e.ownerId === userId).sort((a, b) => b.createdAt - a.createdAt));
  });
}

export async function acceptExchange(id, ownerId) {
  const snap = await get(ref(db, 'exchanges/' + id));
  const ex = snap.val();
  if (!ex || ex.ownerId !== ownerId) throw new Error('Нет доступа');
  await update(ref(db, 'exchanges/' + id), { status: 'accepted', acceptedAt: Date.now() });
  await createNotification(ex.initiatorId, 'exchange_accepted', 'Ваш запрос на обмен принят', id);
}

export async function rejectExchange(id, ownerId) {
  const snap = await get(ref(db, 'exchanges/' + id));
  const ex = snap.val();
  if (!ex || ex.ownerId !== ownerId) throw new Error('Нет доступа');
  await update(ref(db, 'exchanges/' + id), { status: 'rejected' });
  await createNotification(ex.initiatorId, 'exchange_rejected', 'Ваш запрос на обмен отклонён', id);
}

export async function uploadVideo(exchangeId, userId, file) {
  if (file.size > 500 * 1024) throw new Error('Видео больше 500 КБ');
  const base64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => res(e.target.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  const snap = await get(ref(db, 'exchanges/' + exchangeId));
  const ex = snap.val();
  if (!ex || (ex.initiatorId !== userId && ex.ownerId !== userId)) throw new Error('Нет доступа');
  if (ex.status !== 'accepted') throw new Error('Обмен не активен');
  const patch = {};
  if (userId === ex.initiatorId) patch.initiatorVideo = base64;
  else patch.ownerVideo = base64;
  const nI = patch.initiatorVideo || ex.initiatorVideo;
  const nO = patch.ownerVideo || ex.ownerVideo;
  let completed = false;
  if (nI && nO) { patch.status = 'completed'; patch.completedAt = Date.now(); completed = true; }
  await update(ref(db, 'exchanges/' + exchangeId), patch);
  if (completed) {
    for (const uid of [ex.initiatorId, ex.ownerId]) {
      const uSnap = await get(ref(db, 'users/' + uid));
      const u = uSnap.val();
      if (u) await update(ref(db, 'users/' + uid), { coins: (u.coins || 0) + 1 });
      await createNotification(uid, 'exchange_completed', 'Обмен завершён. Начислен 1 Тайм-коин.', exchangeId);
    }
  }
  return { completed };
}

export async function sendMessage(exchangeId, senderId, text) {
  const t = clean(text);
  if (!t.trim()) throw new Error('Пустое сообщение');
  if (t.length > 1000) throw new Error('Слишком длинное');
  const r = push(ref(db, 'messages/' + exchangeId));
  await set(r, { id: r.key, senderId, text: t, createdAt: Date.now() });
}

export function watchMessages(exchangeId, cb) {
  return onValue(ref(db, 'messages/' + exchangeId), snap => {
    const data = snap.val() || {};
    cb(Object.values(data).sort((a, b) => a.createdAt - b.createdAt));
  });
}

export async function createNotification(userId, type, text, exchangeId) {
  const r = push(ref(db, 'notifications/' + userId));
  await set(r, { id: r.key, type, text, exchangeId: exchangeId || null, read: false, createdAt: Date.now() });
}

export function watchNotifications(userId, cb) {
  return onValue(ref(db, 'notifications/' + userId), snap => {
    const data = snap.val() || {};
    cb(Object.values(data).sort((a, b) => b.createdAt - a.createdAt));
  });
}

export async function markNotificationsRead(userId) {
  const snap = await get(ref(db, 'notifications/' + userId));
  const data = snap.val() || {};
  const updates = {};
  Object.keys(data).forEach(k => { if (!data[k].read) updates[k + '/read'] = true; });
  if (Object.keys(updates).length) await update(ref(db, 'notifications/' + userId), updates);
}

export async function createReview(exchangeId, fromUserId, toUserId, rating, text) {
  const r = push(ref(db, 'reviews/' + toUserId));
  await set(r, {
    id: r.key, exchangeId, fromUserId,
    rating: Math.max(1, Math.min(5, rating)),
    text: clean(text || ''), createdAt: Date.now()
  });
}

export function watchReviews(userId, cb) {
  return onValue(ref(db, 'reviews/' + userId), snap => {
    const data = snap.val() || {};
    cb(Object.values(data).sort((a, b) => b.createdAt - a.createdAt));
  });
}

export function watchUserRating(userId, cb) {
  return onValue(ref(db, 'reviews/' + userId), snap => {
    const list = Object.values(snap.val() || {});
    const count = list.length;
    const avg = count ? (list.reduce((s, r) => s + r.rating, 0) / count) : 0;
    cb({ avg, count });
  });
}

export async function createReport(fromUserId, listingId, reason) {
  const r = push(ref(db, 'reports'));
  await set(r, { id: r.key, fromUserId, listingId, reason: clean(reason), createdAt: Date.now() });
}