import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  linkWithCredential, EmailAuthProvider, signOut,
  setPersistence, browserLocalPersistence, updateProfile
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc,
  query, orderBy, limit, onSnapshot, serverTimestamp,
  where, getDocs, writeBatch, runTransaction
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDoBHs7Rw4Aufn1qByWcFSVBXYk23BFRDw",
  authDomain: "a1acomments.firebaseapp.com",
  projectId: "a1acomments",
  storageBucket: "a1acomments.firebasestorage.app",
  messagingSenderId: "272786289312",
  appId: "1:272786289312:web:5b093ebbf184df89d1cfc5"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const postsRef = collection(db, "wall-posts");
const counterRef = doc(db, "counters", "wall-posts");

async function getNextCommentNumber() {
  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(counterRef);
    const current = snap.exists() ? snap.data().count : 0;
    const next = current + 1;
    transaction.set(counterRef, { count: next });
    return next;
  });
}

async function backfillCommentNumbers() {
  const allQuery = query(postsRef, orderBy('timestamp', 'asc'));
  const snap = await getDocs(allQuery);
  const missing = snap.docs.filter(d => !d.data().commentNumber);
  if (missing.length === 0) {
    alert('Nothing to backfill — every comment already has a number.');
    return;
  }
  const counterSnap = await getDocs(query(postsRef, orderBy('commentNumber', 'desc'), limit(1)));
  let next = counterSnap.empty ? 0 : (counterSnap.docs[0].data().commentNumber || 0);

  const batch = writeBatch(db);
  missing.forEach(d => {
    next += 1;
    batch.update(doc(db, 'wall-posts', d.id), { commentNumber: next });
  });
  await batch.commit();
  await updateDoc(counterRef, { count: next }).catch(async () => {
    await runTransaction(db, async (t) => { t.set(counterRef, { count: next }); });
  });
  alert('Backfilled ' + missing.length + ' comment(s) with numbers 1 through ' + next + '.');
}

await setPersistence(auth, browserLocalPersistence);

let currentUid = null;
const ADMIN_UID = "4pb0S6fy0thedwfadk15QzXRCas1";

const nameInput = document.getElementById('wall-name');
const subjectInput = document.getElementById('wall-subject');
const savedName = localStorage.getItem('wall-name');
if (savedName) nameInput.value = savedName;

const settingsLink = document.getElementById('acct-settings-link');
const settingsPanel = document.getElementById('acct-settings-panel');
const acctNameInput = document.getElementById('acct-name-input');
const acctNameSaveBtn = document.getElementById('acct-name-save-btn');

settingsLink.addEventListener('click', () => {
  const isOpen = settingsPanel.style.display === 'flex';
  settingsPanel.style.display = isOpen ? 'none' : 'flex';
  if (!isOpen) acctNameInput.value = nameInput.value;
});

async function renameExistingPosts(newName) {
  if (!currentUid) return;
  try {
    const mineQuery = query(postsRef, where('authorUid', '==', currentUid));
    const snap = await getDocs(mineQuery);
    if (snap.empty) return;
    const batch = writeBatch(db);
    snap.forEach((docSnap) => {
      batch.update(doc(db, 'wall-posts', docSnap.id), { name: newName });
    });
    await batch.commit();
  } catch (err) {
    console.error('failed to rename existing posts', err);
  }
}

function saveCurrentName(newName) {
  nameInput.value = newName;
  localStorage.setItem('wall-name', newName);
  if (auth.currentUser && !auth.currentUser.isAnonymous && newName !== auth.currentUser.displayName) {
    updateProfile(auth.currentUser, { displayName: newName }).catch(err => console.error(err));
  }
  if (auth.currentUser && auth.currentUser.isAnonymous) {
    guestNameEl.textContent = newName || 'anonymous';
  }
  renameExistingPosts(newName);
}

acctNameSaveBtn.addEventListener('click', () => {
  saveCurrentName(acctNameInput.value.trim());
  settingsPanel.style.display = 'none';
});

const messageInput = document.getElementById('wall-message');
const submitBtn = document.getElementById('wall-submit');
const statusEl = document.getElementById('wall-status');
const postsEl = document.getElementById('wall-posts');
const loadingEl = document.getElementById('wall-loading');
const guestView = document.getElementById('acct-guest-view');
const loggedinView = document.getElementById('acct-loggedin-view');
const guestNameEl = document.getElementById('acct-guest-name');
const emailDisplay = document.getElementById('acct-email-display');
const acctError = document.getElementById('acct-error');
const signupName = document.getElementById('acct-signup-name');
const signupEmail = document.getElementById('acct-signup-email');
const signupPassword = document.getElementById('acct-signup-password');
const loginEmail = document.getElementById('acct-login-email');
const loginPassword = document.getElementById('acct-login-password');

function showAcctError(msg) {
  acctError.textContent = msg;
}

const BANNED_NAMES = ["giancarlo scopazzi", "gcscope"];

function normalizeName(str) {
  return str.trim().toLowerCase().replace(/[^a-z]/g, '');
}

function isNameBanned(name) {
  if (currentUid === ADMIN_UID) return false;
  const normalized = normalizeName(name);
  return BANNED_NAMES.some(banned => normalizeName(banned) === normalized);
}

document.getElementById('acct-signup-btn').addEventListener('click', async () => {
  showAcctError('');
  const chosenName = signupName.value.trim();
  const email = signupEmail.value.trim();
  const password = signupPassword.value;
  if (!chosenName) {
    showAcctError('enter a username.');
    return;
  }
  if (isNameBanned(chosenName)) {
    showAcctError("that username isn't available.");
    return;
  }
  if (!email || password.length < 6) {
    showAcctError('enter a valid email and a password of 6+ characters.');
    return;
  }
  try {
    const credential = EmailAuthProvider.credential(email, password);
    let user;
    if (auth.currentUser && auth.currentUser.isAnonymous) {
      const result = await linkWithCredential(auth.currentUser, credential);
      user = result.user;
    } else {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      user = result.user;
    }
    await updateProfile(user, { displayName: chosenName });
    saveCurrentName(chosenName);
  } catch (err) {
    if (err.code === 'auth/email-already-in-use') {
      showAcctError('an account with that email already exists.');
    } else {
      showAcctError(err.message.replace('Firebase: ', ''));
    }
  }
});

document.getElementById('acct-login-btn').addEventListener('click', async () => {
  showAcctError('');
  const email = loginEmail.value.trim();
  const password = loginPassword.value;
  if (!email || !password) {
    showAcctError('enter your email and password.');
    return;
  }
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    showAcctError(err.message.replace('Firebase: ', ''));
  }
});

document.getElementById('acct-logout-btn').addEventListener('click', async () => {
  await signOut(auth);
  await signInAnonymously(auth);
});

if (ADMIN_UID) {
  onAuthStateChanged(auth, (user) => {
    if (user && user.uid === ADMIN_UID) {
      const backfillBtn = document.createElement('button');
      backfillBtn.className = 'acct-btn';
      backfillBtn.textContent = 'backfill comment numbers';
      backfillBtn.style.marginTop = '8px';
      backfillBtn.addEventListener('click', backfillCommentNumbers);
      loggedinView.appendChild(backfillBtn);
    }
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderFormattedText(str) {
  let escaped = escapeHtml(str);
  escaped = escaped.replace(/([^\s:]+):(\d+)/g, (match, name, num) => {
    return '<a href="#comment-' + num + '" class="wall-reply-link" data-num="' + num + '">' + match + '</a>';
  });
  escaped = escaped
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>');
  return escaped;
}

function wrapSelection(textarea, marker) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  const selected = value.slice(start, end) || 'text';
  const newValue = value.slice(0, start) + marker + selected + marker + value.slice(end);
  textarea.value = newValue;
  textarea.focus();
  textarea.selectionStart = start + marker.length;
  textarea.selectionEnd = start + marker.length + selected.length;
}

document.querySelectorAll('#wall-toolbar .fmt-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    wrapSelection(messageInput, btn.dataset.marker);
  });
});

postsEl.addEventListener('click', (e) => {
  const link = e.target.closest('.wall-reply-link');
  if (!link) return;
  e.preventDefault();
  const num = link.dataset.num;
  const target = document.getElementById('comment-' + num);
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('wall-highlight');
    setTimeout(() => target.classList.remove('wall-highlight'), 1500);
  }
});

function insertReplyText(text) {
  const start = messageInput.selectionStart ?? messageInput.value.length;
  const end = messageInput.selectionEnd ?? messageInput.value.length;
  const value = messageInput.value;
  messageInput.value = value.slice(0, start) + text + value.slice(end);
  messageInput.focus();
  const cursor = start + text.length;
  messageInput.selectionStart = cursor;
  messageInput.selectionEnd = cursor;
  messageInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function timeAgo(date) {
  if (!date) return '';
  const seconds = Math.floor((new Date() - date) / 1000);
  const units = [
    ['year', 31536000], ['month', 2592000], ['day', 86400],
    ['hour', 3600], ['minute', 60]
  ];
  for (const [name, secs] of units) {
    const val = Math.floor(seconds / secs);
    if (val >= 1) return val + ' ' + name + (val > 1 ? 's' : '') + ' ago';
  }
  return 'just now';
}

function renderPosts(snapshot) {
  loadingEl.remove?.();
  postsEl.innerHTML = '';
  if (snapshot.empty) {
    postsEl.innerHTML = '<p style="font-size: 10pt; color: rgb(140,140,140);">No posts yet. Be the first.</p>';
    return;
  }
  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const id = docSnap.id;
    const time = data.timestamp ? data.timestamp.toDate() : null;
    const isOwner = currentUid && data.authorUid === currentUid;
    const el = document.createElement('div');
    el.className = 'wall-post';
    if (data.commentNumber) el.id = 'comment-' + data.commentNumber;
    const subjectP = document.createElement('p');
    subjectP.className = 'wall-post-subject';
    subjectP.textContent = data.subject || '(no subject)';
    const metaP = document.createElement('p');
    metaP.className = 'wall-post-meta';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'wall-post-name';
    nameSpan.textContent = data.name || 'anonymous';
    metaP.appendChild(nameSpan);
    metaP.append(' — ' + timeAgo(time) + (data.editedAt ? ' (edited)' : ''));
    const messageP = document.createElement('p');
    messageP.className = 'wall-post-text';
    messageP.innerHTML = renderFormattedText(data.message);
    el.appendChild(subjectP);
    el.appendChild(metaP);
    el.appendChild(messageP);

    const replyRow = document.createElement('div');
    replyRow.className = 'wall-reply-row';
    const replyBtn = document.createElement('button');
    replyBtn.className = 'wall-btn';
    replyBtn.textContent = 'reply';
    replyBtn.addEventListener('click', () => {
      insertReplyText((data.name || 'anonymous') + ':' + (data.commentNumber || '?') + ' ');
    });
    replyRow.appendChild(replyBtn);
    el.appendChild(replyRow);

    if (isOwner) {
      const actions = document.createElement('div');
      actions.className = 'wall-post-actions';
      const editBtn = document.createElement('button');
      editBtn.className = 'wall-btn';
      editBtn.textContent = 'edit';
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'wall-btn danger';
      deleteBtn.textContent = 'delete';
      editBtn.addEventListener('click', () => startEdit(el, id, data));
      deleteBtn.addEventListener('click', () => handleDelete(id));
      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);
      el.appendChild(actions);
    }
    postsEl.appendChild(el);
  });
}

function startEdit(postEl, id, data) {
  postEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'wall-edit-area';
  const subjectField = document.createElement('input');
  subjectField.type = 'text';
  subjectField.maxLength = 80;
  subjectField.value = data.subject || '';
  const editToolbar = document.createElement('div');
  editToolbar.id = 'wall-toolbar';
  editToolbar.innerHTML = `
    <button type="button" class="fmt-btn" data-marker="**" title="Bold"><b>B</b></button>
    <button type="button" class="fmt-btn" data-marker="*" title="Italic"><i>I</i></button>
    <button type="button" class="fmt-btn" data-marker="__" title="Underline"><u>U</u></button>
    <button type="button" class="fmt-btn" data-marker="~~" title="Strikethrough"><s>S</s></button>
  `;
  const messageField = document.createElement('textarea');
  messageField.maxLength = 2000;
  messageField.value = data.message || '';
  messageField.style.minHeight = '70px';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'wall-btn';
  saveBtn.textContent = 'save';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'wall-btn';
  cancelBtn.textContent = 'cancel';
  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.gap = '8px';
  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
  wrap.appendChild(subjectField);
  wrap.appendChild(messageField);
  wrap.appendChild(editToolbar);
  wrap.appendChild(actions);
  editToolbar.querySelectorAll('.fmt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      wrapSelection(messageField, btn.dataset.marker);
    });
  });
  postEl.appendChild(wrap);
  saveBtn.addEventListener('click', async () => {
    const newSubject = subjectField.value.trim().slice(0, 80);
    const newMessage = messageField.value.trim().slice(0, 2000);
    if (!newMessage) return;
    saveBtn.disabled = true;
    try {
      await updateDoc(doc(db, 'wall-posts', id), {
        subject: newSubject,
        message: newMessage,
        editedAt: serverTimestamp()
      });
    } catch (err) {
      console.error(err);
      alert("Couldn't save the edit.");
      saveBtn.disabled = false;
    }
  });
  cancelBtn.addEventListener('click', () => renderPosts(lastSnapshot));
}

async function handleDelete(id) {
  if (!confirm('Delete this comment? This can\'t be undone.')) return;
  try {
    await deleteDoc(doc(db, 'wall-posts', id));
  } catch (err) {
    console.error(err);
    alert("Couldn't delete this post.");
  }
}

let lastSnapshot = null;
const q = query(postsRef, orderBy('timestamp', 'desc'), limit(200));
onSnapshot(q, (snap) => { lastSnapshot = snap; renderPosts(snap); }, (err) => {
  postsEl.innerHTML = '<p style="font-size: 10pt; color: rgb(200,80,80);">Couldn\'t load comments. Check your Firebase config.</p>';
  console.error(err);
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUid = user.uid;
    if (lastSnapshot) renderPosts(lastSnapshot);
    if (user.isAnonymous) {
      guestView.style.display = 'block';
      loggedinView.style.display = 'none';
      guestNameEl.textContent = nameInput.value.trim() || 'anonymous';
    } else {
      guestView.style.display = 'none';
      loggedinView.style.display = 'block';
      emailDisplay.textContent = user.email;
      if (user.displayName) {
        nameInput.value = user.displayName;
      }
    }
  } else {
    // no session at all (first-ever visit, or after logout) — start as guest
    signInAnonymously(auth).catch((err) => console.error('anon auth failed', err));
  }
});

nameInput.addEventListener('input', () => {
  if (auth.currentUser && auth.currentUser.isAnonymous) {
    guestNameEl.textContent = nameInput.value.trim() || 'anonymous';
  }
});

submitBtn.addEventListener('click', async () => {
  if (!currentUid) {
    statusEl.textContent = "still connecting, try again in a second.";
    return;
  }
  const message = messageInput.value.trim();
  const subject = subjectInput.value.trim();
  const chosenName = nameInput.value.trim();
  if (chosenName && isNameBanned(chosenName)) {
    statusEl.textContent = "that username isn't available.";
    return;
  }
  if (!subject) {
    statusEl.textContent = "give it a subject.";
    return;
  }
  if (!message) {
    statusEl.textContent = "say something first.";
    return;
  }
  submitBtn.disabled = true;
  statusEl.textContent = "posting...";
  try {
    const commentNumber = await getNextCommentNumber();
    await addDoc(postsRef, {
      name: nameInput.value.trim().slice(0, 40) || 'anonymous',
      subject: subject.slice(0, 80),
      message: message.slice(0, 2000),
      authorUid: currentUid,
      commentNumber: commentNumber,
      timestamp: serverTimestamp()
    });
    subjectInput.value = '';
    messageInput.value = '';
    statusEl.textContent = "posted.";
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  } catch (err) {
    statusEl.textContent = "something went wrong, try again.";
    console.error(err);
  }
  submitBtn.disabled = false;
});
