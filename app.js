import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getDatabase, ref, set, push, onValue, get, update, serverTimestamp, onDisconnect, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyBLGvyu8giBW3-UCHWhSKj3dBGAF7H3LJE", 
    authDomain: "gram-e36b7.firebaseapp.com",
    databaseURL: "https://gram-e36b7-default-rtdb.europe-west1.firebasedatabase.app/", 
    projectId: "gram-e36b7",
    storageBucket: "gram-e36b7.firebasestorage.app",
    messagingSenderId: "227438877829",
    appId: "1:227438877829:web:5c0bc7206e296c07745dec"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const ADMIN_UID = "JeZl7O25HYZExlEL0lFregV7DnE2";
const IMGBB_KEY = "1bd59a712d0379609fcac4f092344dd7";

let currentUser = null;
let myUsername = ""; 
let activeChatId = null;
let currentFriendUid = null;
let currentFriendNick = null;

let myStars = 0; 

let messagesUnsubscribe = null;
let statusUnsubscribe = null;
let typingUnsubscribe = null;
let streakUnsubscribe = null;
let channelUnsubscribe = null;

let currentFriendStatusHTML = '';
let currentFriendStatusClass = '';
let isFriendTyping = false;
let typingTimer;

let selectedMsgId = null; 
let selectedMsgText = "";
let selectedMsgSender = null; 
let isEditing = false; 
let isReplying = false;

window.chatGiftsData = {};
window.myShowcaseData = {};
window.friendShowcaseData = {};
window.currentChannelData = null; 

window.currentTabIndex = 2; 

// ====== ЛОКАЛЬНЫЙ КЭШ (МГНОВЕННЫЙ СТАРТ - TELEGRAM STYLE) ======
window.cachedContactsMap = JSON.parse(localStorage.getItem('812gram_contacts_map') || '{}');

window.renderCachedData = function() {
    // 1. Отрисовываем профиль из памяти
    const cachedProfile = JSON.parse(localStorage.getItem('812gram_profile') || '{}');
    if (cachedProfile.username) {
        document.getElementById('my-name').innerText = cachedProfile.username;
        document.getElementById('profile-name-large').innerText = cachedProfile.username;
        const displayStars = (cachedProfile.uid === ADMIN_UID) ? "999,999+ ⭐" : (cachedProfile.stars || 0) + " ⭐";
        document.getElementById('my-balance').innerText = displayStars;
        document.getElementById('profile-balance-large').innerText = displayStars;
        if (cachedProfile.avatarUrl) {
            window.applyAvatar('profile-avatar-large', cachedProfile.username, cachedProfile.avatarUrl);
            window.applyAvatar('tab-my-avatar', cachedProfile.username, cachedProfile.avatarUrl);
        }
    }

    // 2. Отрисовываем список чатов из памяти
    const container = document.getElementById('contacts-list');
    if (Object.keys(window.cachedContactsMap).length > 0 && container) {
        container.innerHTML = "";
        const contactsArr = Object.values(window.cachedContactsMap).sort((a,b) => (b.time || 0) - (a.time || 0));
        contactsArr.forEach(c => {
            const div = document.createElement('div');
            div.className = "contact-item";
            div.onclick = () => window.startChat(c.uid, c.nick);
            div.innerHTML = `
                <div class="avatar" id="ava-cache-${c.uid}" ${c.isChan ? 'style="border-radius: 15px;"' : ''}>${c.nick.charAt(0).toUpperCase()}</div>
                <div class="contact-info">
                    <div class="name-row"><div class="name">${c.isChan ? '📣 ' : ''}${c.nick}</div></div>
                    <div class="msg-row">
                        <div class="last-msg">${c.lastMsgText || '...'}</div>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <div style="font-size: 11px; color: var(--text-muted);">${c.timeStr || ''}</div>
                            <div class="unread-badge" style="display: ${c.unreadCount > 0 ? 'flex' : 'none'};">${c.unreadCount || 0}</div>
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(div);
            if (c.avatarUrl) window.applyAvatar(`ava-cache-${c.uid}`, c.nick, c.avatarUrl);
        });
    }
};

window.updateProfileCache = function(avatarUrl) {
    if (!currentUser) return;
    let currentCache = JSON.parse(localStorage.getItem('812gram_profile') || '{}');
    currentCache.uid = currentUser.uid;
    currentCache.username = myUsername;
    currentCache.stars = myStars;
    if (avatarUrl !== undefined) currentCache.avatarUrl = avatarUrl;
    localStorage.setItem('812gram_profile', JSON.stringify(currentCache));
};

// Запускаем мгновенную отрисовку кэша ПРЯМО ПРИ СТАРТЕ ФАЙЛА!
window.renderCachedData();
// ===============================================================

const soundSend = new Audio('send.mp3');
const soundReceive = new Audio('receive.mp3');
soundSend.volume = 0.6; soundReceive.volume = 0.8;

if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") { Notification.requestPermission(); }

window.applyAvatar = function(elementId, letter, avatarUrl) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (avatarUrl) {
        el.style.backgroundImage = `url('${avatarUrl}')`;
        el.classList.add('avatar-img-applied');
        el.innerText = '';
    } else {
        el.style.backgroundImage = 'linear-gradient(135deg, var(--msg-out), var(--accent))';
        el.classList.remove('avatar-img-applied');
        if(letter) el.innerText = letter.charAt(0).toUpperCase();
    }
};

window.uploadAvatar = async function(event, type) {
    const file = event.target.files[0];
    if (!file) return;
    
    const btn = event.target.previousElementSibling;
    const origText = btn.innerText;
    btn.innerText = "⏳ Загрузка...";
    btn.style.pointerEvents = "none";

    const formData = new FormData(); formData.append("image", file);

    try {
        const response = await fetch("https://api.imgbb.com/1/upload?key=" + IMGBB_KEY, { method: "POST", body: formData });
        const data = await response.json();
        
        if (data.success) {
            const avatarUrl = data.data.url;
            if (type === 'user') {
                await update(ref(db, `users/${currentUser.uid}`), { avatarUrl: avatarUrl });
                window.applyAvatar('profile-avatar-large', myUsername, avatarUrl);
                window.applyAvatar('tab-my-avatar', myUsername, avatarUrl);
                alert("Аватарка успешно обновлена!");
            } else if (type === 'channel' && activeChatId) {
                await update(ref(db, `channels/${activeChatId}`), { avatarUrl: avatarUrl });
                window.applyAvatar('cp-avatar', window.currentChannelData.name, avatarUrl);
                alert("Аватарка канала обновлена!");
            }
        } else { alert("Ошибка загрузки фото!"); }
    } catch (err) { alert("Ошибка сети при загрузке!"); }
    
    btn.innerText = origText; btn.style.pointerEvents = "auto"; event.target.value = '';
};

onAuthStateChanged(auth, (user) => {
    if (user) { currentUser = user; window.loadMyProfile(); window.setupPresence(); } 
    else { window.location.href = "index.html"; }
});

window.setupPresence = function() {
    const connectedRef = ref(db, '.info/connected');
    onValue(connectedRef, (snap) => {
        if (snap.val() === true && currentUser) {
            const myStatusRef = ref(db, `users/${currentUser.uid}/status`);
            onDisconnect(myStatusRef).set(serverTimestamp()).then(() => { set(myStatusRef, 'online'); });
        }
    });
};

window.loadMyProfile = async function() {
    const starRef = ref(db, `users/${currentUser.uid}/wallet/stars`);
    onValue(starRef, (snap) => {
        const isAdmin = (currentUser.uid === ADMIN_UID);
        myStars = isAdmin ? 999999 : (snap.val() || 0);
        const displayStars = isAdmin ? "999,999+ ⭐" : myStars + " ⭐";
        document.getElementById('my-balance').innerText = displayStars;
        document.getElementById('profile-balance-large').innerText = displayStars;
        window.updateProfileCache(); // Обновляем кэш баланса
    });

    const snapshot = await get(ref(db, 'users/' + currentUser.uid));
    if (snapshot.exists()) {
        const data = snapshot.val();
        myUsername = data.username;
        document.getElementById('my-name').innerText = myUsername;
        document.getElementById('profile-name-large').innerText = myUsername;
        window.applyAvatar('profile-avatar-large', myUsername, data.avatarUrl);
        window.applyAvatar('tab-my-avatar', myUsername, data.avatarUrl);
        window.updateProfileCache(data.avatarUrl); // Обновляем кэш профиля
    }

    get(ref(db, 'channels')).then(snap => {
        if (snap.exists()) {
            snap.forEach(child => {
                let cData = child.val();
                let cId = child.key;
                if (cData.autoSubscribe) {
                    if (!cData.members || !cData.members[currentUser.uid]) {
                        set(ref(db, `channels/${cId}/members/${currentUser.uid}`), 'subscriber');
                        set(ref(db, `users/${currentUser.uid}/chats/${cId}`), cData.name);
                    }
                }
            });
        }
    });

    window.loadContacts(); window.loadShowcase(); 
    window.checkInviteLink(); 
};

window.checkInviteLink = async function() {
    const urlParams = new URLSearchParams(window.location.search);
    const chanId = urlParams.get('c');
    if (chanId && chanId.startsWith('chan_')) {
        try {
            const snap = await get(ref(db, `channels/${chanId}`));
            if (snap.exists()) {
                const data = snap.val();
                window.history.replaceState({}, document.title, window.location.pathname);
                window.startChat(chanId, data.name);
            } else { alert("Канал не найден или был удален."); }
        } catch (e) { console.error(e); }
    }
};

window.loadShowcase = function() {
    onValue(ref(db, `users/${currentUser.uid}/showcase`), (snap) => {
        const grid = document.getElementById('showcase-grid');
        grid.innerHTML = ''; window.myShowcaseData = {};
        if(snap.exists()) {
            snap.forEach(child => {
                const gift = child.val(); window.myShowcaseData[child.key] = gift;
                grid.innerHTML += `<div class="showcase-item" onclick="openGiftDetails('myShowcase', '${child.key}')"><div class="showcase-icon">${gift.giftIcon}</div><div class="showcase-name">${gift.giftName}</div><div class="showcase-from">от: ${gift.from}</div></div>`;
            });
        } else { grid.innerHTML = `<div class="empty-list-text">Витрина пока пуста...</div>`; }
    });
};

window.unreadCounts = {}; window.chatListeners = {};

window.updateTotalUnread = function() {
    let total = Object.values(window.unreadCounts).reduce((a, b) => a + b, 0);
    const totalBadge = document.getElementById('total-unread-badge');
    if (totalBadge) { totalBadge.innerText = total; totalBadge.style.display = total > 0 ? 'block' : 'none'; }
};

window.loadContacts = function() {
    const contactsRef = ref(db, `users/${currentUser.uid}/chats`);
    onValue(contactsRef, (snapshot) => {
        const container = document.getElementById('contacts-list');
        Object.values(window.chatListeners).forEach(unsub => unsub());
        window.chatListeners = {}; container.innerHTML = ""; 

        if (snapshot.exists()) {
            snapshot.forEach((child) => {
                const fUid = child.key; const fNick = child.val();
                const chatId = fUid.startsWith('chan_') ? fUid : (currentUser.uid < fUid ? currentUser.uid + "_" + fUid : fUid + "_" + currentUser.uid);
                const isChan = fUid.startsWith('chan_');

                // Достаем кэш, чтобы не было пустых строк до загрузки сообщений
                const cached = window.cachedContactsMap[fUid] || {};
                if (!window.cachedContactsMap[fUid]) {
                    window.cachedContactsMap[fUid] = { uid: fUid, nick: fNick, isChan: isChan, time: 0 };
                }

                const div = document.createElement('div');
                div.className = "contact-item";
                div.dataset.time = cached.time || 0; 
                div.onclick = () => window.startChat(fUid, fNick);
                
                div.innerHTML = `
                    <div class="avatar" id="ava-${fUid}" ${isChan ? 'style="border-radius: 15px;"' : ''}>${fNick.charAt(0).toUpperCase()}</div>
                    <div class="contact-info">
                        <div class="name-row"><div class="name">${isChan ? '📣 ' : ''}${fNick}</div></div>
                        <div class="msg-row">
                            <div class="last-msg" id="last-msg-${fUid}">${cached.lastMsgText || '...'}</div>
                            <div style="display:flex; align-items:center; gap:6px;">
                                <div id="last-time-${fUid}" style="font-size: 11px; color: var(--text-muted);">${cached.timeStr || ''}</div>
                                <div class="unread-badge" id="unread-${fUid}" style="display: ${cached.unreadCount > 0 ? 'flex' : 'none'};">${cached.unreadCount || 0}</div>
                            </div>
                        </div>
                    </div>
                `;
                container.appendChild(div);

                get(ref(db, isChan ? `channels/${fUid}/avatarUrl` : `users/${fUid}/avatarUrl`)).then(avaSnap => {
                    const avaUrl = avaSnap.val();
                    window.applyAvatar(`ava-${fUid}`, fNick, avaUrl);
                    // Кэшируем аватарку
                    window.cachedContactsMap[fUid].avatarUrl = avaUrl;
                    localStorage.setItem('812gram_contacts_map', JSON.stringify(window.cachedContactsMap));
                });

                if (cached.avatarUrl) {
                    window.applyAvatar(`ava-${fUid}`, fNick, cached.avatarUrl);
                }

                const unsub = onValue(ref(db, 'messages/' + chatId), (msgSnap) => {
                    let unreadCount = 0; let lastMsgText = "Нет сообщений"; let latestTime = 0;
                    if (msgSnap.exists()) {
                        msgSnap.forEach(mChild => {
                            const m = mChild.val();
                            if (m.timestamp > latestTime) latestTime = m.timestamp;
                            
                            if (m.type === 'gift') lastMsgText = `🎁 Подарок: ${m.giftName}`;
                            else if (m.type === 'system') lastMsgText = `[Система]: Стрик! 🔥`;
                            else if (m.text && m.text.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i)) lastMsgText = `📷 Фотография`;
                            else lastMsgText = m.text;
                            
                            if (m.senderId !== currentUser.uid && m.read === false) unreadCount++;
                        });
                    }
                    
                    const lastMsgEl = document.getElementById(`last-msg-${fUid}`); 
                    const unreadEl = document.getElementById(`unread-${fUid}`);
                    const lastTimeEl = document.getElementById(`last-time-${fUid}`);
                    
                    if (lastMsgEl) lastMsgEl.innerText = lastMsgText;
                    if (unreadEl) {
                        if (unreadCount > 0) { unreadEl.innerText = unreadCount; unreadEl.style.display = 'flex'; } 
                        else { unreadEl.style.display = 'none'; }
                    }
                    if (lastTimeEl && latestTime > 0) {
                        let d = new Date(latestTime);
                        lastTimeEl.innerText = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
                    }
                    
                    // Обновляем кэш
                    window.cachedContactsMap[fUid].lastMsgText = lastMsgText;
                    window.cachedContactsMap[fUid].unreadCount = unreadCount;
                    window.cachedContactsMap[fUid].time = latestTime;
                    window.cachedContactsMap[fUid].timeStr = lastTimeEl ? lastTimeEl.innerText : '';
                    localStorage.setItem('812gram_contacts_map', JSON.stringify(window.cachedContactsMap));

                    div.dataset.time = latestTime;
                    const parent = document.getElementById('contacts-list');
                    if (parent) {
                        const arr = Array.from(parent.children);
                        arr.sort((a,b) => (b.dataset.time || 0) - (a.dataset.time || 0));
                        arr.forEach(node => parent.appendChild(node));
                    }
                    
                    window.unreadCounts[fUid] = unreadCount; window.updateTotalUnread();
                });
                window.chatListeners[fUid] = unsub; 
            });
            
            // Финальная сортировка при загрузке
            const arr = Array.from(container.children);
            arr.sort((a,b) => (b.dataset.time || 0) - (a.dataset.time || 0));
            arr.forEach(node => container.appendChild(node));

        } else { window.unreadCounts = {}; window.updateTotalUnread(); }
    });
};

window.findFriend = async function() {
    const searchNick = document.getElementById('search-input').value.trim();
    if(!searchNick) return;
    try {
        let found = false;
        const snapshot = await get(ref(db, 'users'));
        if (snapshot.exists()) {
            snapshot.forEach((child) => {
                const friendData = child.val();
                if (friendData && friendData.username && friendData.username.toLowerCase() === searchNick.toLowerCase()) {
                    window.startChat(child.key, friendData.username); found = true;
                }
            });
        }
        if(!found) {
            const chanSnap = await get(ref(db, 'channels'));
            if (chanSnap.exists()) {
                chanSnap.forEach(child => {
                    const c = child.val();
                    if (c.type === 'public' && c.name.toLowerCase() === searchNick.toLowerCase()) {
                        window.startChat(child.key, c.name); found = true;
                    }
                });
            }
        }
        if (!found) alert("Пользователь или публичный канал не найден!");
    } catch (error) { alert("Ошибка БД: " + error.message); }
};

window.updateStatusUI = function() {
    const statusDiv = document.getElementById('chat-status');
    if (isFriendTyping) { statusDiv.innerText = 'печатает...'; statusDiv.className = 'status-typing'; } 
    else { statusDiv.innerText = currentFriendStatusHTML; statusDiv.className = currentFriendStatusClass; }
};

window.switchTab = function(tabName) {
    const chatsView = document.getElementById('chats-view');
    const profileView = document.getElementById('profile-view');
    let targetIndex = (tabName === 'chats') ? 2 : 3;

    if (window.currentTabIndex === targetIndex) return;

    document.querySelectorAll('.tab-item').forEach(el => el.classList.remove('active'));
    if (tabName === 'chats') {
        document.getElementById('tab-chats-btn').classList.add('active');
    } else {
        document.getElementById('tab-profile-btn').classList.add('active');
    }
    document.querySelector('.app-container').classList.remove('show-mobile-chat');

    let newView = (tabName === 'chats') ? chatsView : profileView;
    let oldView = (window.currentTabIndex === 2) ? chatsView : profileView;
    
    const isForward = targetIndex > window.currentTabIndex;
    window.currentTabIndex = targetIndex;

    const parent = oldView.parentElement;
    parent.style.position = 'relative';
    parent.style.overflowX = 'hidden';

    oldView.style.position = 'absolute';
    oldView.style.top = '0';
    oldView.style.left = '0';
    oldView.style.width = '100%';
    oldView.style.height = '100%';
    oldView.style.zIndex = '1';

    newView.style.display = 'flex';
    newView.style.position = 'relative';
    newView.style.zIndex = '2';

    const duration = 350;
    const easing = 'cubic-bezier(0.25, 1, 0.5, 1)'; 

    newView.animate([
        { transform: `translateX(${isForward ? '100%' : '-100%'})` },
        { transform: 'translateX(0)' }
    ], { duration, easing });

    const outAnim = oldView.animate([
        { transform: 'translateX(0)' },
        { transform: `translateX(${isForward ? '-30%' : '30%'})`, opacity: 0.3 }
    ], { duration, easing });

    outAnim.onfinish = () => {
        oldView.style.display = 'none';
        oldView.style.position = '';
        oldView.style.width = '';
        oldView.style.height = '';
        oldView.style.zIndex = '';
        newView.style.position = '';
        newView.style.zIndex = '';
    };
};

window.startChat = function(friendUid, friendNick) {
    currentFriendUid = friendUid; currentFriendNick = friendNick;
    const isChannel = friendUid.startsWith('chan_');
    activeChatId = isChannel ? friendUid : (currentUser.uid < friendUid ? currentUser.uid + "_" + friendUid : friendUid + "_" + currentUser.uid);
    
    document.getElementById('chat-title').innerText = friendNick;
    document.getElementById('top-bar-container').style.display = 'flex';
    document.getElementById('welcome-msg').style.display = 'none';
    document.querySelector('.app-container').classList.add('show-mobile-chat');

    if (statusUnsubscribe) statusUnsubscribe(); if (typingUnsubscribe) typingUnsubscribe();
    if (streakUnsubscribe) streakUnsubscribe(); if (channelUnsubscribe) channelUnsubscribe();

    if (isChannel) {
        document.getElementById('streak-icon-container').style.display = 'none';
        currentFriendStatusClass = 'status-offline';
        
        channelUnsubscribe = onValue(ref(db, `channels/${friendUid}`), (snap) => {
            const data = snap.val();
            if(!data) return;
            window.currentChannelData = data;
            const subCount = Object.keys(data.members || {}).length;
            currentFriendStatusHTML = `${subCount} подписчиков`;
            window.updateStatusUI();
            
            if(document.getElementById('chat-title').innerText !== data.name) {
                document.getElementById('chat-title').innerText = data.name;
            }

            const isCreator = (data.creator === currentUser.uid);
            const myRole = data.members && data.members[currentUser.uid];
            const isAdmin = isCreator || myRole === 'admin';
            const isSubbed = !!myRole;

            if (isAdmin) {
                document.getElementById('bottom-input-wrap').style.display = 'flex';
                document.getElementById('channel-sub-area').style.display = 'none';
            } else {
                document.getElementById('bottom-input-wrap').style.display = 'none';
                document.getElementById('channel-sub-area').style.display = 'flex';
                document.getElementById('channel-sub-text').innerText = isSubbed ? 'ОТПИСАТЬСЯ ОТ КАНАЛА' : 'ПОДПИСАТЬСЯ НА КАНАЛ';
                document.getElementById('channel-sub-area').style.background = isSubbed ? 'rgba(255,255,255,0.05)' : 'var(--accent)';
            }
        });
    } else {
        window.currentChannelData = null;
        document.getElementById('streak-icon-container').style.display = 'flex';
        document.getElementById('bottom-input-wrap').style.display = 'flex';
        document.getElementById('channel-sub-area').style.display = 'none';

        statusUnsubscribe = onValue(ref(db, `users/${friendUid}/status`), (snapshot) => {
            const val = snapshot.val();
            if (val === 'online') { currentFriendStatusHTML = 'В сети'; currentFriendStatusClass = 'status-online'; } 
            else if (val) { const date = new Date(val); currentFriendStatusHTML = `был(а) в ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`; currentFriendStatusClass = 'status-offline'; } 
            else { currentFriendStatusHTML = 'был(а) недавно'; currentFriendStatusClass = 'status-offline'; }
            window.updateStatusUI();
        });

        typingUnsubscribe = onValue(ref(db, `typing/${activeChatId}/${friendUid}`), (snapshot) => {
            isFriendTyping = !!snapshot.val(); window.updateStatusUI();
        });

        streakUnsubscribe = onValue(ref(db, `streaks/${activeChatId}`), (snap) => { window.updateStreakUI(snap.val()); });
    }

    window.cancelAction(); window.loadMessages();
};

window.goBack = function() { document.querySelector('.app-container').classList.remove('show-mobile-chat'); };

function escapeHTML(str) {
    if(!str) return "";
    return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag]));
}

function formatMessageText(text) {
    if(!text) return "";
    let safeText = escapeHTML(text); const urlRegex = /(https?:\/\/[^\s]+)/g;
    return safeText.replace(urlRegex, (url) => {
        if (url.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i)) { return `<br><img src="${url}" class="chat-img" onclick="window.open('${url}')"><br>`; } 
        else if (url.match(/\.(mp3|wav|ogg)(\?.*)?$/i)) { return `<br><audio controls src="${url}" class="chat-audio"></audio><br>`; } 
        else { return `<a href="${url}" target="_blank" class="chat-link">${url}</a>`; }
    });
}

window.updateStreakUI = function(data) {
return;
    const streakIconContainer = document.getElementById('streak-icon-container'); const streakCount = document.getElementById('streak-count');
    if (!data || data.count === 0) { streakIconContainer.style.display = 'none'; return; }
    streakIconContainer.style.display = 'flex'; streakCount.innerText = data.count;
    const todayStr = new Date().toDateString();
    const myDate = (data.participants && data.participants[currentUser.uid]) || "";
    const friendDate = (data.participants && data.participants[currentFriendUid]) || "";
    
    if (myDate === todayStr && friendDate === todayStr) { streakIconContainer.className = 'streak-fire streak-active'; } 
    else { streakIconContainer.className = 'streak-fire streak-pending'; }

    if (data.count === 1) {
        const tutKey = 'tut_streak_' + activeChatId + '_' + data.lastDate;
        if (!localStorage.getItem(tutKey)) { window.openStreakTutorial(); localStorage.setItem(tutKey, 'true'); }
    }
};

window.processStreakLogic = async function() {
return;
    if(activeChatId.startsWith('chan_')) return;
    const streakRef = ref(db, `streaks/${activeChatId}`); const snap = await get(streakRef);
    let data = snap.val() || { count: 0, lastDate: "", participants: {} };
    const todayStr = new Date().toDateString(); const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); const yesterdayStr = yesterday.toDateString();

    if (!data.participants) data.participants = {};
    if (data.lastDate && data.lastDate !== todayStr && data.lastDate !== yesterdayStr) { data.count = 0; }

    data.participants[currentUser.uid] = todayStr; const friendDate = data.participants[currentFriendUid] || "";
    if (friendDate === todayStr) {
        if (data.lastDate !== todayStr) { data.count++; data.lastDate = todayStr; window.checkStreakRewards(data.count); }
    }
    set(streakRef, data);
};

window.checkStreakRewards = function(count) {
    let reward = 0;
    if (count === 3) reward = 5; if (count === 10) reward = 10; if (count === 20) reward = 20;
    if (reward > 0) {
        if (currentUser.uid !== ADMIN_UID) { get(ref(db, `users/${currentUser.uid}/wallet/stars`)).then(s => { set(ref(db, `users/${currentUser.uid}/wallet/stars`), (s.val() || 0) + reward); }); }
        if (currentFriendUid !== ADMIN_UID) { get(ref(db, `users/${currentFriendUid}/wallet/stars`)).then(s => { set(ref(db, `users/${currentFriendUid}/wallet/stars`), (s.val() || 0) + reward); }); }
        push(ref(db, 'messages/' + activeChatId), { senderId: "system", type: "system", text: `🔥 Стрик ${count} дня! Вы оба получаете по ${reward} ⭐`, timestamp: Date.now(), read: true });
    }
};

window.loadMessages = function() {
    if (messagesUnsubscribe) messagesUnsubscribe(); 
    let isFirstLoad = true; let lastMsgCount = 0;
    const msgRef = ref(db, 'messages/' + activeChatId);
    messagesUnsubscribe = onValue(msgRef, (snapshot) => {
        const container = document.getElementById('messages'); container.innerHTML = "";
        let currentMsgCount = 0; let lastMessage = null; let unreadUpdates = {}; window.chatGiftsData = {};

        snapshot.forEach((child) => {
            currentMsgCount++; const m = child.val(); const msgKey = child.key; lastMessage = m;
            if (m.senderId !== currentUser.uid && m.read === false) { unreadUpdates[msgKey + '/read'] = true; }

            const isMe = m.senderId === currentUser.uid;
            
            // НОВАЯ ОБЕРТКА ДЛЯ СООБЩЕНИЯ И ВРЕМЕНИ
            const wrap = document.createElement('div');
            wrap.className = isMe ? "msg-wrap me" : "msg-wrap";

            const div = document.createElement('div');
            div.className = isMe ? "msg me" : "msg"; div.id = 'msg-' + msgKey; 
            
            if(m.type !== 'gift' && m.type !== 'system') { div.onclick = () => window.showMsgOptions(msgKey, m.text, m.senderId); }
            
            let msgHTML = '';
            if (m.type === 'system') {
                msgHTML += `<div style="text-align: center; width: 100%; color: var(--gold); font-size: 13px; font-weight: bold; background: rgba(255,255,255,0.05); padding: 5px 15px; border-radius: 20px; border: 1px solid rgba(241, 196, 15, 0.3); margin: 10px 0;">${escapeHTML(m.text)}</div>`;
                div.style.background = 'transparent'; div.style.padding = '0'; div.style.alignSelf = 'center'; div.style.maxWidth = '100%'; div.style.boxShadow = 'none';
                wrap.style.alignSelf = 'center'; // Центруем системные сообщения
            } else if (m.type === 'gift') {
                window.chatGiftsData[msgKey] = m; let actionHTML = '';
                if (m.claimed) { actionHTML = `<div class="gift-status-text">На витрине ✨</div>`; } 
                else if (m.senderId === currentUser.uid && !activeChatId.startsWith('chan_')) { actionHTML = `<div class="gift-status-text">Ждет получателя ⏳</div>`; } 
                else { actionHTML = `<button class="gift-msg-btn" onclick="claimGift(event, '${msgKey}')">Забрать на витрину</button>`; }
                msgHTML += `<div class="gift-msg-card" onclick="openGiftDetails('chat', '${msgKey}')"><div class="gift-msg-icon">${m.giftIcon}</div><div class="gift-msg-title">${m.giftName}</div>${actionHTML}</div>`;
            } else {
                if (m.reply) { msgHTML += `<div class="msg-reply-block" onclick="scrollToMsg(event, '${m.reply.originalMsgId}')"><b>${m.reply.senderName}</b><span class="msg-reply-text">${escapeHTML(m.reply.text)}</span></div>`; }
                msgHTML += `<span class="msg-text">${formatMessageText(m.text)}</span>`;
                if (m.edited) { msgHTML += `<span class="edited-label">изменено</span>`; }
            }
            
            if (isMe && m.type !== 'system' && !activeChatId.startsWith('chan_')) {
                if (m.read) { msgHTML += `<span class="ticks read">✓✓</span>`; } else { msgHTML += `<span class="ticks">✓</span>`; }
            }
            div.innerHTML = msgHTML; 
            wrap.appendChild(div);

            // ДОБАВЛЯЕМ СТЕКЛЯННЫЙ ОВАЛ ВРЕМЕНИ
            if (m.type !== 'system') {
                let d = new Date(m.timestamp || Date.now());
                let timeStr = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
                let timePill = document.createElement('div');
                timePill.className = "msg-time-glass";
                timePill.innerText = timeStr;
                wrap.appendChild(timePill);
            }

            container.appendChild(wrap);
        });

        if (isFirstLoad || currentMsgCount > lastMsgCount) { container.scrollTop = container.scrollHeight; }
        if (!isFirstLoad && currentMsgCount > lastMsgCount) {
            if (lastMessage && lastMessage.senderId !== currentUser.uid) {
                soundReceive.currentTime = 0; soundReceive.play().catch(() => {}); 
                if (document.hidden && "Notification" in window && Notification.permission === "granted") {
                    let notifBody = lastMessage.text;
                    if(lastMessage.type === 'gift') notifBody = '🎁 Прислал(а) подарок!';
                    else if(lastMessage.type === 'system') notifBody = 'Системное уведомление';
                    else if(lastMessage.text && lastMessage.text.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i)) notifBody = '📷 Фотография';
                    new Notification(currentFriendNick, { body: notifBody, icon: "icon-192.png" });
                }
            }
        }
        if (Object.keys(unreadUpdates).length > 0) { setTimeout(() => { update(ref(db, `messages/${activeChatId}`), unreadUpdates); }, 50); }
        lastMsgCount = currentMsgCount; isFirstLoad = false;
    });
};

window.scrollToMsg = function(event, msgId) {
    event.stopPropagation(); if (!msgId) return;
    const targetMsg = document.getElementById('msg-' + msgId);
    if (targetMsg) { targetMsg.scrollIntoView({ behavior: 'smooth', block: 'center' }); targetMsg.classList.add('highlight-msg'); setTimeout(() => targetMsg.classList.remove('highlight-msg'), 2000); }
};

window.handleTyping = function() {
    if (!activeChatId || activeChatId.startsWith('chan_')) return;
    set(ref(db, `typing/${activeChatId}/${currentUser.uid}`), true);
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { set(ref(db, `typing/${activeChatId}/${currentUser.uid}`), null); }, 1500);
};

window.handleEnter = function(event) { if (event.key === 'Enter') { window.sendMsg(); } };

window.sendMsg = async function() {
    const text = document.getElementById('msg-input').value.trim();
    if(!text || !activeChatId) return;
    soundSend.currentTime = 0; soundSend.play().catch(() => {});

    if (isEditing && selectedMsgId) {
        update(ref(db, `messages/${activeChatId}/${selectedMsgId}`), { text: text, edited: true });
    } else {
        let newMsg = { senderId: currentUser.uid, text: text, timestamp: Date.now(), read: false };
        if (isReplying) { newMsg.reply = { text: selectedMsgText, senderName: selectedMsgSender === currentUser.uid ? myUsername : currentFriendNick, originalMsgId: selectedMsgId }; }
        await push(ref(db, 'messages/' + activeChatId), newMsg);
        window.processStreakLogic();
    }
    window.cancelAction();
    if(!activeChatId.startsWith('chan_')) {
        set(ref(db, `typing/${activeChatId}/${currentUser.uid}`), null);
        set(ref(db, `users/${currentUser.uid}/chats/${currentFriendUid}`), currentFriendNick);
        set(ref(db, `users/${currentFriendUid}/chats/${currentUser.uid}`), myUsername);
    }
};

window.uploadImage = async function(event) {
    const file = event.target.files[0];
    if (!file || !activeChatId) return;

    const formData = new FormData();
    formData.append("image", file);
    
    const attachBtn = document.getElementById('attach-btn');
    const originalHTML = attachBtn.innerHTML;
    attachBtn.innerHTML = "⏳";
    attachBtn.style.pointerEvents = "none";

    try {
        const response = await fetch("https://api.imgbb.com/1/upload?key=" + IMGBB_KEY, {
            method: "POST",
            body: formData
        });
        const data = await response.json();
        
        if (data.success) {
            const imageUrl = data.data.url;
            let newMsg = { senderId: currentUser.uid, text: imageUrl, timestamp: Date.now(), read: false };
            await push(ref(db, 'messages/' + activeChatId), newMsg);
            window.processStreakLogic();
            
            if(!activeChatId.startsWith('chan_')) {
                set(ref(db, `typing/${activeChatId}/${currentUser.uid}`), null);
                set(ref(db, `users/${currentUser.uid}/chats/${currentFriendUid}`), currentFriendNick);
                set(ref(db, `users/${currentFriendUid}/chats/${currentUser.uid}`), myUsername);
            }
            soundSend.currentTime = 0; soundSend.play().catch(() => {});
        } else {
            alert("Ошибка загрузки: " + data.error.message);
        }
    } catch (err) {
        alert("Ошибка сети при загрузке фото.");
    } finally {
        attachBtn.innerHTML = originalHTML;
        attachBtn.style.pointerEvents = "auto";
        event.target.value = ''; 
    }
};

window.showMsgOptions = function(msgKey, text, senderId) {
    selectedMsgId = msgKey; selectedMsgText = text; selectedMsgSender = senderId;
    const isMine = (senderId === currentUser.uid);
    
    if(activeChatId.startsWith('chan_') && (!window.currentChannelData || window.currentChannelData.creator !== currentUser.uid)) return;
    
    document.getElementById('modal-edit-btn').style.display = isMine ? 'block' : 'none';
    document.getElementById('modal-del-btn').style.display = isMine ? 'block' : 'none';
    document.getElementById('msg-options-modal').style.display = 'flex';
};

window.closeMsgOptions = function() { document.getElementById('msg-options-modal').style.display = 'none'; };

window.openStore = function() {
    const modal = document.getElementById('store-modal');
    modal.style.display = 'flex';
    const content = modal.querySelector('.store-modal');
    if(content) {
        content.animate([
            { transform: 'translateX(-100vw)', opacity: 0 },
            { transform: 'translateX(0)', opacity: 1 }
        ], { duration: 350, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' });
    }
};
window.closeStore = function() { document.getElementById('store-modal').style.display = 'none'; };

document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('.tab-item');
    if (tabs[1]) {
        tabs[1].onclick = function() {
            const modal = document.getElementById('global-settings-modal');
            modal.style.display = 'flex';
            const glass = modal.querySelector('.glass-modal');
            if (glass) {
                glass.animate([
                    { transform: 'translateX(-100vw)', opacity: 0 },
                    { transform: 'translateX(0)', opacity: 1 }
                ], { duration: 350, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' });
            }
        };
    }
});

window.pendingGift = null;
window.pendingGiftRecipient = null; 

window.openBuyGiftModal = function(giftName, price, icon) {
    window.pendingGift = { giftName, price, icon };
    document.getElementById('store-modal').style.display = 'none';
    window.openGiftRecipientModal();
};

window.openGiftRecipientModal = function() {
    document.getElementById('gift-recipient-modal').style.display = 'flex';
    const list = document.getElementById('gift-recipient-list');
    list.innerHTML = '<div style="text-align:center; margin-top:20px;">Загрузка контактов...</div>';

    get(ref(db, `users/${currentUser.uid}/chats`)).then(snap => {
        list.innerHTML = '';
        if(snap.exists()) {
            let hasChats = false;
            const chats = [];
            snap.forEach(child => { chats.push({ uid: child.key, name: child.val() }); });

            for (let chat of chats) {
                hasChats = true;
                const isChan = chat.uid.startsWith('chan_');
                list.innerHTML += `
                    <div class="contact-item" onclick="selectGiftRecipient('${chat.uid}', '${chat.name}', ${isChan})" style="background: rgba(255,255,255,0.05); margin-bottom:10px;">
                        <div class="avatar" id="gr-ava-${chat.uid}" ${isChan ? 'style="border-radius: 15px;"' : ''}>${chat.name.charAt(0).toUpperCase()}</div>
                        <div class="name" style="flex-grow:1;">${isChan ? '📣 ' : ''}${chat.name}</div>
                    </div>
                `;
            }
            if(!hasChats) list.innerHTML = `<div class="empty-list-text">Нет доступных чатов для отправки.</div>`;

            for (let chat of chats) {
                const isChan = chat.uid.startsWith('chan_');
                get(ref(db, isChan ? `channels/${chat.uid}/avatarUrl` : `users/${chat.uid}/avatarUrl`)).then(avaSnap => {
                    window.applyAvatar(`gr-ava-${chat.uid}`, chat.name, avaSnap.val());
                });
            }
        } else { list.innerHTML = `<div class="empty-list-text">У вас пока нет контактов...</div>`; }
    });
};

window.closeGiftRecipientModal = function() { document.getElementById('gift-recipient-modal').style.display = 'none'; };
window.backToStoreFromRecipient = function() { window.closeGiftRecipientModal(); document.getElementById('store-modal').style.display = 'flex'; };

window.selectGiftRecipient = function(uid, name, isChannel) {
    window.pendingGiftRecipient = { uid, name, isChannel };
    window.closeGiftRecipientModal();
    window.openGiftPreviewModal();
};

window.openGiftPreviewModal = function() {
    document.getElementById('preview-gift-icon').innerText = window.pendingGift.icon;
    document.getElementById('preview-gift-name').innerText = window.pendingGift.giftName;
    document.getElementById('preview-from-name').innerText = myUsername; 
    
    document.getElementById('preview-to-name').innerText = window.pendingGiftRecipient.name;
    document.getElementById('preview-gift-price').innerText = (currentUser.uid === ADMIN_UID) ? 0 : window.pendingGift.price;
    
    document.getElementById('preview-gift-text').value = ''; 
    document.getElementById('gift-preview-modal').style.display = 'flex';
};

window.closeGiftPreviewModal = function() { document.getElementById('gift-preview-modal').style.display = 'none'; };
window.backToRecipientFromPreview = function() { window.closeGiftPreviewModal(); window.openGiftRecipientModal(); };

window.confirmBuyGiftFinal = function() {
    let price = window.pendingGift.price;
    if (myStars >= price || currentUser.uid === ADMIN_UID) {
        if (currentUser.uid !== ADMIN_UID) { myStars -= price; set(ref(db, `users/${currentUser.uid}/wallet/stars`), myStars); }
        let textInput = document.getElementById('preview-gift-text').value.trim();
        
        const recUid = window.pendingGiftRecipient.uid;
        const isChan = window.pendingGiftRecipient.isChannel;
        const targetChatId = isChan ? recUid : (currentUser.uid < recUid ? currentUser.uid + "_" + recUid : recUid + "_" + currentUser.uid);

        let giftMsg = { 
            senderId: currentUser.uid, 
            type: 'gift', 
            giftName: window.pendingGift.giftName, 
            giftIcon: window.pendingGift.icon, 
            price: price, 
            giftText: textInput, 
            claimed: false, 
            timestamp: Date.now(), 
            read: false 
        };
        
        push(ref(db, 'messages/' + targetChatId), giftMsg);
        soundSend.currentTime = 0; soundSend.play().catch(() => {});
        
        if(!isChan) {
            set(ref(db, `users/${currentUser.uid}/chats/${recUid}`), window.pendingGiftRecipient.name);
            set(ref(db, `users/${recUid}/chats/${currentUser.uid}`), myUsername);
        }
        
        alert(`Подарок "${window.pendingGift.giftName}" успешно отправлен: ${window.pendingGiftRecipient.name}!`);
        window.closeGiftPreviewModal();
    } else { alert(`Недостаточно звезд! У тебя ${myStars} ⭐, а нужно ${price} ⭐.`); }
};

window.openGiftDetails = function(source, key) {
    let gift = null;
    if (source === 'chat') gift = window.chatGiftsData[key];
    if (source === 'myShowcase') gift = window.myShowcaseData[key];
    if (source === 'friendShowcase') gift = window.friendShowcaseData[key];
    if (!gift) return;
    document.getElementById('det-gift-icon').innerText = gift.giftIcon; document.getElementById('det-gift-name').innerText = gift.giftName;
    let fromName = gift.from || (gift.senderId === currentUser.uid ? myUsername : currentFriendNick);
    document.getElementById('det-gift-from').innerText = fromName; document.getElementById('det-gift-price').innerText = gift.price + ' ⭐';
    let dateObj = new Date(gift.sentTimestamp || gift.timestamp);
    document.getElementById('det-gift-date').innerText = dateObj.toLocaleDateString('ru-RU', {day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute:'2-digit'});
    document.getElementById('det-gift-text').innerText = escapeHTML(gift.giftText ? gift.giftText : 'Без подписи...');
    document.getElementById('gift-details-modal').style.display = 'flex';
};
window.closeGiftDetails = function() { document.getElementById('gift-details-modal').style.display = 'none'; };

window.claimGift = function(event, msgKey) {
    event.stopPropagation(); let gift = window.chatGiftsData[msgKey]; if(!gift) return;
    if(activeChatId && activeChatId.startsWith('chan_')) {
        if(window.currentChannelData && window.currentChannelData.creator === currentUser.uid) {
            push(ref(db, `channels/${activeChatId}/showcase`), { giftName: gift.giftName, giftIcon: gift.giftIcon, price: gift.price, giftText: gift.giftText || "", from: myUsername, sentTimestamp: gift.timestamp, timestamp: Date.now() });
            update(ref(db, `messages/${activeChatId}/${msgKey}`), { claimed: true });
            alert(`Ура! Подарок "${gift.giftName}" теперь на витрине канала!`);
        } else { alert("Только создатель канала может забирать подарки на витрину!"); }
    } else {
        push(ref(db, `users/${currentUser.uid}/showcase`), { giftName: gift.giftName, giftIcon: gift.giftIcon, price: gift.price, giftText: gift.giftText || "", from: currentFriendNick, sentTimestamp: gift.timestamp, timestamp: Date.now() });
        update(ref(db, `messages/${activeChatId}/${msgKey}`), { claimed: true });
        alert(`Ура! Подарок "${gift.giftName}" теперь на твоей витрине!`);
    }
};

window.openCurrentProfile = function() {
    if(activeChatId && activeChatId.startsWith('chan_')) { window.openChannelProfile(); } 
    else { window.openFriendProfile(); }
}

window.openFriendProfile = function() {
    if(!currentFriendUid) return;
    document.getElementById('friend-name-large').innerText = currentFriendNick;
    
    get(ref(db, `users/${currentFriendUid}/avatarUrl`)).then(snap => {
        window.applyAvatar('friend-avatar-large', currentFriendNick, snap.val());
    });

    document.getElementById('friend-profile-modal').style.display = 'flex';
    onValue(ref(db, `users/${currentFriendUid}/showcase`), (snap) => {
        const grid = document.getElementById('friend-showcase-grid'); grid.innerHTML = ''; window.friendShowcaseData = {};
        if(snap.exists()) {
            snap.forEach(child => { const gift = child.val(); window.friendShowcaseData[child.key] = gift; grid.innerHTML += `<div class="showcase-item" onclick="openGiftDetails('friendShowcase', '${child.key}')"><div class="showcase-icon">${gift.giftIcon}</div><div class="showcase-name">${gift.giftName}</div><div class="showcase-from">от: ${gift.from}</div></div>`; });
        } else { grid.innerHTML = `<div class="empty-list-text">Витрина пока пуста...</div>`; }
    }, { onlyOnce: true });
};
window.closeFriendProfile = function() { document.getElementById('friend-profile-modal').style.display = 'none'; };

window.openChannelProfile = function() {
    if(!window.currentChannelData) return;
    const data = window.currentChannelData;
    document.getElementById('cp-name').innerText = data.name;
    window.applyAvatar('cp-avatar', data.name, data.avatarUrl);
    document.getElementById('cp-subs').innerText = Object.keys(data.members || {}).length + ' подписчиков';
    document.getElementById('cp-desc').innerText = data.desc || 'Нет описания';
    document.getElementById('cp-link').innerText = data.inviteLink || 'Нет ссылки';
    
    document.getElementById('cp-settings-btn').style.display = (data.creator === currentUser.uid) ? 'block' : 'none';
    document.getElementById('channel-profile-modal').style.display = 'flex';

    onValue(ref(db, `channels/${activeChatId}/showcase`), (snap) => {
        const grid = document.getElementById('channel-profile-showcase'); grid.innerHTML = ''; window.friendShowcaseData = {}; 
        if(snap.exists()) {
            snap.forEach(child => { const gift = child.val(); window.friendShowcaseData[child.key] = gift; grid.innerHTML += `<div class="showcase-item" onclick="openGiftDetails('friendShowcase', '${child.key}')"><div class="showcase-icon">${gift.giftIcon}</div><div class="showcase-name">${gift.giftName}</div><div class="showcase-from">от: ${gift.from}</div></div>`; });
        } else { grid.innerHTML = `<div class="empty-list-text">Витрина канала пуста...</div>`; }
    }, { onlyOnce: true });
};
window.closeChannelProfile = function() { document.getElementById('channel-profile-modal').style.display = 'none'; };

window.openChannelSettings = function() {
    if(!window.currentChannelData) return;
    document.getElementById('edit-chan-name').value = window.currentChannelData.name;
    document.getElementById('edit-chan-desc').value = window.currentChannelData.desc || '';
    
    if (currentUser.uid === ADMIN_UID) {
        document.getElementById('admin-auto-sub-container').style.display = 'block';
        document.getElementById('edit-chan-autosub').value = window.currentChannelData.autoSubscribe ? "true" : "false";
    } else {
        document.getElementById('admin-auto-sub-container').style.display = 'none';
    }

    document.getElementById('channel-settings-modal').style.display = 'flex';
};
window.closeChannelSettings = function() { document.getElementById('channel-settings-modal').style.display = 'none'; };

window.saveChannelSettings = async function() {
    const newName = document.getElementById('edit-chan-name').value.trim();
    const newDesc = document.getElementById('edit-chan-desc').value.trim();
    if(!newName) return alert("Имя не может быть пустым!");

    let updates = { name: newName, desc: newDesc };
    if (currentUser.uid === ADMIN_UID) {
        updates.autoSubscribe = document.getElementById('edit-chan-autosub').value === "true";
    }

    await update(ref(db, `channels/${activeChatId}`), updates);
    
    const members = window.currentChannelData.members || {};
    let globalUpdates = {};
    for(let uid in members) { globalUpdates[`users/${uid}/chats/${activeChatId}`] = newName; }
    await update(ref(db), globalUpdates);

    alert("Настройки сохранены!");
    window.closeChannelSettings();
    window.closeChannelProfile();
};

window.openManageMembers = async function() {
    document.getElementById('channel-manage-members-modal').style.display = 'flex';
    const list = document.getElementById('manage-members-list');
    list.innerHTML = '<div style="text-align:center; margin-top:20px;">Загрузка...</div>';

    const members = window.currentChannelData.members || {};
    list.innerHTML = '';
    
    for(let uid in members) {
        const role = members[uid];
        const uSnap = await get(ref(db, `users/${uid}/username`));
        const uName = uSnap.val() || "Неизвестный";
        const isMe = uid === currentUser.uid;
        
        list.innerHTML += `
            <div class="contact-item" style="background: rgba(255,255,255,0.05); margin-bottom:10px; display:flex; flex-wrap:wrap; gap:10px; align-items:center;">
                <div class="avatar" style="width:40px; height:40px; font-size:16px;">${uName.charAt(0).toUpperCase()}</div>
                <div class="name" style="flex-grow:1; display:flex; flex-direction:column;">
                    <span>${uName} ${isMe ? '(Вы)' : ''}</span>
                    <span style="font-size:10px; color:var(--accent);">${role === 'admin' ? 'Админ' : 'Подписчик'}</span>
                </div>
                ${!isMe ? `
                    <button class="gift-msg-btn" style="width:auto; padding:5px 10px; background:var(--msg-out);" onclick="toggleAdmin('${uid}', '${role}')">${role === 'admin' ? 'Забрать права' : 'Сделать админом'}</button>
                    <button class="gift-msg-btn" style="width:auto; padding:5px 10px; background:#ff4757;" onclick="kickMember('${uid}', '${uName}')">Выгнать</button>
                ` : ''}
            </div>
        `;
    }
};
window.closeManageMembers = function() { document.getElementById('channel-manage-members-modal').style.display = 'none'; };

window.selectedNewMembers = [];
window.openAddMoreMembers = function() {
    document.getElementById('add-more-members-modal').style.display = 'flex';
    const list = document.getElementById('add-more-members-list');
    list.innerHTML = ''; window.selectedNewMembers = [];
    
    get(ref(db, `users/${currentUser.uid}/chats`)).then(snap => {
        if(snap.exists()) {
            let found = false;
            snap.forEach(child => {
                const uid = child.key; const nick = child.val();
                if(!uid.startsWith('chan_') && (!window.currentChannelData.members || !window.currentChannelData.members[uid])) {
                    found = true;
                    list.innerHTML += `
                        <div class="contact-item" onclick="toggleNewMember('${uid}')" style="background: rgba(255,255,255,0.05); margin-bottom:10px;">
                            <div class="avatar">${nick.charAt(0).toUpperCase()}</div>
                            <div class="name" style="flex-grow:1;">${nick}</div>
                            <input type="checkbox" id="chk-new-${uid}" style="width:20px; height:20px; pointer-events:none;">
                        </div>`;
                }
            });
            if(!found) list.innerHTML = `<div class="empty-list-text">Нет доступных контактов для добавления.</div>`;
        } else { list.innerHTML = `<div class="empty-list-text">У вас пока нет контактов...</div>`; }
    });
}
window.closeAddMoreMembers = function() { document.getElementById('add-more-members-modal').style.display = 'none'; };

window.toggleNewMember = function(uid) {
    const chk = document.getElementById(`chk-new-${uid}`); chk.checked = !chk.checked;
    if(chk.checked) window.selectedNewMembers.push(uid); else window.selectedNewMembers = window.selectedNewMembers.filter(id => id !== uid);
};

window.confirmAddMoreMembers = async function() {
    if(window.selectedNewMembers.length === 0) return alert("Никто не выбран!");
    let updates = {};
    for(let uid of window.selectedNewMembers) {
        updates[`channels/${activeChatId}/members/${uid}`] = 'subscriber';
        updates[`users/${uid}/chats/${activeChatId}`] = window.currentChannelData.name;
    }
    await update(ref(db), updates);
    alert("Участники добавлены!");
    window.closeAddMoreMembers();
    window.openManageMembers(); 
};

window.toggleAdmin = async function(uid, currentRole) {
    const newRole = currentRole === 'admin' ? 'subscriber' : 'admin';
    await set(ref(db, `channels/${activeChatId}/members/${uid}`), newRole);
    alert("Роль успешно изменена!");
    window.currentChannelData.members[uid] = newRole; 
    window.openManageMembers(); 
};

window.kickMember = async function(uid, uName) {
    if(confirm(`Выгнать ${uName} из канала?`)) {
        await remove(ref(db, `channels/${activeChatId}/members/${uid}`));
        await remove(ref(db, `users/${uid}/chats/${activeChatId}`));
        alert(`${uName} удален из канала.`);
        delete window.currentChannelData.members[uid];
        window.openManageMembers(); 
    }
};

window.deleteChannel = async function() {
    if(confirm("ВЫ УВЕРЕНЫ? Канал и все сообщения будут удалены навсегда для всех!")) {
        const members = window.currentChannelData.members || {};
        let updates = {};
        for(let uid in members) { updates[`users/${uid}/chats/${activeChatId}`] = null; }
        updates[`channels/${activeChatId}`] = null;
        updates[`messages/${activeChatId}`] = null;
        await update(ref(db), updates);
        alert("Канал успешно удален.");
        window.location.reload();
    }
};

window.openStreakTutorial = function() { document.getElementById('streak-tutorial-modal').style.display = 'flex'; }
window.closeStreakTutorial = function() { document.getElementById('streak-tutorial-modal').style.display = 'none'; };

window.startReply = function() { window.closeMsgOptions(); isReplying = true; isEditing = false; const name = selectedMsgSender === currentUser.uid ? myUsername : currentFriendNick; document.getElementById('reply-name').innerText = name; document.getElementById('reply-text').innerText = selectedMsgText; document.getElementById('reply-preview-container').style.display = 'block'; document.getElementById('cancel-action-btn').style.display = 'flex'; document.getElementById('msg-input').focus(); };
window.startEdit = function() { window.closeMsgOptions(); isEditing = true; isReplying = false; document.getElementById('msg-input').value = selectedMsgText; document.getElementById('send-btn').innerText = '✓'; document.getElementById('reply-preview-container').style.display = 'none'; document.getElementById('cancel-action-btn').style.display = 'flex'; document.getElementById('msg-input').focus(); };
window.cancelAction = function() { isEditing = false; isReplying = false; selectedMsgId = null; selectedMsgText = ""; selectedMsgSender = null; document.getElementById('msg-input').value = ""; document.getElementById('send-btn').innerText = '>'; document.getElementById('reply-preview-container').style.display = 'none'; document.getElementById('cancel-action-btn').style.display = 'none'; };
window.confirmDelete = function() { if (selectedMsgId && activeChatId) { remove(ref(db, `messages/${activeChatId}/${selectedMsgId}`)); window.cancelAction(); window.closeMsgOptions(); } };

window.openCreateMenu = function() { document.getElementById('create-menu-modal').style.display = 'flex'; };
window.closeCreateMenu = function() { document.getElementById('create-menu-modal').style.display = 'none'; };

window.startCreateChannel = function() {
    document.getElementById('create-menu-modal').style.display = 'none';
    document.getElementById('new-chan-name').value = ''; document.getElementById('new-chan-desc').value = '';
    document.getElementById('create-channel-modal').style.display = 'flex';
};
window.closeCreateChannel = function() { document.getElementById('create-channel-modal').style.display = 'none'; };

window.selectedMembers = [];
window.openChannelMembers = function() {
    const name = document.getElementById('new-chan-name').value.trim();
    if(!name) { alert('Введите название канала!'); return; }
    document.getElementById('create-channel-modal').style.display = 'none';
    document.getElementById('channel-members-modal').style.display = 'flex';
    
    const list = document.getElementById('channel-members-list'); list.innerHTML = ''; window.selectedMembers = [];
    get(ref(db, `users/${currentUser.uid}/chats`)).then(snap => {
        if(snap.exists()) {
            let found = false;
            snap.forEach(child => {
                const uid = child.key; const nick = child.val();
                if(!uid.startsWith('chan_')) {
                    found = true;
                    list.innerHTML += `
                        <div class="contact-item" onclick="toggleMember('${uid}')" style="background: rgba(255,255,255,0.05); margin-bottom:10px;">
                            <div class="avatar">${nick.charAt(0).toUpperCase()}</div>
                            <div class="name" style="flex-grow:1;">${nick}</div>
                            <input type="checkbox" id="chk-${uid}" style="width:20px; height:20px; pointer-events:none;">
                        </div>`;
                }
            });
            if(!found) list.innerHTML = `<div class="empty-list-text">У вас пока нет контактов...</div>`;
        } else { list.innerHTML = `<div class="empty-list-text">У вас пока нет контактов...</div>`; }
    });
};

window.toggleMember = function(uid) {
    const chk = document.getElementById(`chk-${uid}`); chk.checked = !chk.checked;
    if(chk.checked) window.selectedMembers.push(uid); else window.selectedMembers = window.selectedMembers.filter(id => id !== uid);
};
window.closeChannelMembers = function() { document.getElementById('channel-members-modal').style.display = 'none'; document.getElementById('create-channel-modal').style.display = 'flex'; };

window.createChannelFinal = async function() {
    const name = document.getElementById('new-chan-name').value.trim();
    const desc = document.getElementById('new-chan-desc').value.trim();
    const type = document.getElementById('new-chan-type').value;
    const chanId = 'chan_' + Date.now();
    const link = window.location.href.split('?')[0] + '?c=' + chanId;
    
    let membersObj = {}; membersObj[currentUser.uid] = 'admin';
    window.selectedMembers.forEach(uid => membersObj[uid] = 'subscriber');
    
    await set(ref(db, `channels/${chanId}`), { name, desc, type, creator: currentUser.uid, inviteLink: link, members: membersObj, timestamp: Date.now() });
    await set(ref(db, `users/${currentUser.uid}/chats/${chanId}`), name);
    for (let uid of window.selectedMembers) { await set(ref(db, `users/${uid}/chats/${chanId}`), name); }
    
    document.getElementById('channel-members-modal').style.display = 'none';
    window.startChat(chanId, name);
};

window.toggleChannelSub = async function() {
    if (!window.currentChannelData || !activeChatId.startsWith('chan_')) return;
    const chanRef = ref(db, `channels/${activeChatId}/members/${currentUser.uid}`);
    const myChatRef = ref(db, `users/${currentUser.uid}/chats/${activeChatId}`);
    const isSubbed = window.currentChannelData.members && window.currentChannelData.members[currentUser.uid];
    
    if (isSubbed) {
        await remove(chanRef); await remove(myChatRef); alert("Вы отписались от канала.");
    } else {
        await set(chanRef, "subscriber"); await set(myChatRef, window.currentChannelData.name); alert("Вы успешно подписались!");
    }
};