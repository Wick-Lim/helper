// Alter WebUI - Simple & Robust with Infinite Scroll
let messages = [];
let currentView = 'chat';
let historyOffset = 0;
let hasMoreHistory = true;
let isLoadingHistory = false;
let refreshInterval = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  console.log('[alter] Initializing...');
  checkHealth();

  // Setup URL routing
  handleRoute();
  window.addEventListener('hashchange', handleRoute);

  // Setup scroll listener for infinite scroll
  const messagesContainer = document.getElementById('messages');
  messagesContainer.addEventListener('scroll', handleScroll);

  // Periodic updates
  setInterval(checkHealth, 15000);

  // Auto-refresh current view
  startAutoRefresh();
});

// URL Routing
function handleRoute() {
  const hash = window.location.hash.slice(1) || '/chat';
  const view = hash.replace('/', '');
  showView(view);

  // Load chat history only on chat view
  if (view === 'chat') {
    loadInitialHistory();
  }
}

// Health Check
async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    const online = res.ok;
    document.getElementById('status-dot').className = `w-2 h-2 rounded-full ${online ? 'bg-green-500' : 'bg-red-500'}`;
    document.getElementById('status-text').textContent = online ? 'Connected' : 'Offline';
  } catch {
    document.getElementById('status-dot').className = 'w-2 h-2 rounded-full bg-red-500';
    document.getElementById('status-text').textContent = 'Offline';
  }
}

// View Switching
function showView(view) {
  currentView = view;

  // Update URL hash (without triggering hashchange)
  if (window.location.hash !== `#/${view}`) {
    history.replaceState(null, '', `#/${view}`);
  }

  // Hide all views
  document.querySelectorAll('[id^="view-"]').forEach(el => el.classList.add('hidden'));

  // Show selected view
  const viewEl = document.getElementById(`view-${view}`);
  if (viewEl) {
    viewEl.classList.remove('hidden');
  }

  // Update sidebar
  document.querySelectorAll('[id^="nav-"]').forEach(el => {
    el.className = el.className.replace('sidebar-active', '').replace('text-blue-400', 'text-gray-400');
    if (!el.className.includes('hover:')) el.className += ' hover:text-white hover:bg-gray-800';
  });

  const navBtn = document.getElementById(`nav-${view}`);
  if (navBtn) {
    navBtn.className = navBtn.className.replace('text-gray-400', 'text-blue-400') + ' sidebar-active';
  }

  // Load data for view
  if (view === 'timeline') loadTimeline();
  if (view === 'thoughts') loadThoughts();
  if (view === 'memory') loadMemory();
  if (view === 'tasks') loadTasks();
  if (view === 'stats') loadStats();
}

// Infinite Scroll Handler
function handleScroll() {
  const container = document.getElementById('messages');

  // Load more when scrolled to top
  if (container.scrollTop < 100 && !isLoadingHistory && hasMoreHistory) {
    loadMoreHistory();
  }

  // Show/hide load more indicator
  const indicator = document.getElementById('load-more-indicator');
  if (hasMoreHistory && container.scrollTop < 200) {
    indicator.classList.remove('hidden');
  } else {
    indicator.classList.add('hidden');
  }
}

// Chat - Load Initial History (최근 50개만, web-session만)
async function loadInitialHistory() {
  try {
    const res = await fetch('/api/conversations?limit=50&offset=0&sessionId=web-session');
    const data = await res.json();

    if (data.length < 50) hasMoreHistory = false;

    messages = data.map(m => ({
      role: m.role === 'model' ? 'assistant' : m.role,
      content: m.content,
      timestamp: m.created_at
    })).reverse();

    historyOffset = data.length;
    renderMessages();
    scrollToBottom();
  } catch (e) {
    console.error('[alter] Failed to load history:', e);
  }
}

// Load More History (위로 스크롤할 때)
async function loadMoreHistory() {
  if (isLoadingHistory || !hasMoreHistory) return;

  isLoadingHistory = true;
  const container = document.getElementById('messages');
  const oldScrollHeight = container.scrollHeight;

  try {
    const res = await fetch(`/api/conversations?limit=50&offset=${historyOffset}&sessionId=web-session`);
    const data = await res.json();

    if (data.length < 50) hasMoreHistory = false;
    if (data.length === 0) {
      isLoadingHistory = false;
      return;
    }

    const oldMessages = data.map(m => ({
      role: m.role === 'model' ? 'assistant' : m.role,
      content: m.content,
      timestamp: m.created_at
    })).reverse();

    messages = [...oldMessages, ...messages];
    historyOffset += data.length;

    renderMessages();

    // Maintain scroll position
    container.scrollTop = container.scrollHeight - oldScrollHeight;
  } catch (e) {
    console.error('[alter] Failed to load more history:', e);
  } finally {
    isLoadingHistory = false;
  }
}

function renderMessages() {
  const container = document.getElementById('messages');
  container.innerHTML = '';

  // Show date dividers
  let lastDate = null;

  messages.forEach((msg, index) => {
    const msgDate = new Date(msg.timestamp).toDateString();

    // Add date divider
    if (msgDate !== lastDate) {
      const divider = document.createElement('div');
      divider.className = 'flex items-center gap-4 my-6';
      divider.innerHTML = `
        <div class="flex-1 h-px bg-gray-200"></div>
        <div class="text-xs text-gray-500 px-3 py-1 bg-gray-100 rounded-full">
          ${formatDate(msg.timestamp)}
        </div>
        <div class="flex-1 h-px bg-gray-200"></div>
      `;
      container.appendChild(divider);
      lastDate = msgDate;
    }

    const div = document.createElement('div');
    div.className = 'chat-message';

    if (msg.role === 'user') {
      div.innerHTML = `
        <div class="flex justify-end gap-2 items-end">
          <div class="text-xs text-gray-400">${formatTime(msg.timestamp)}</div>
          <div class="bg-blue-500 text-white px-4 py-2 rounded-lg max-w-2xl break-words">
            ${escapeHtml(msg.content)}
          </div>
        </div>
      `;
    } else if (msg.role === 'assistant') {
      div.innerHTML = `
        <div class="flex justify-start gap-2 items-end">
          <div class="bg-white border px-4 py-2 rounded-lg max-w-2xl prose prose-sm">
            ${renderMarkdown(msg.content)}
          </div>
          <div class="text-xs text-gray-400">${formatTime(msg.timestamp)}</div>
        </div>
      `;
    }

    container.appendChild(div);
  });
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';

  // Add user message
  messages.push({ role: 'user', content: text, timestamp: new Date().toISOString() });
  renderMessages();

  // Show typing indicator
  const typingDiv = document.createElement('div');
  typingDiv.id = 'typing-indicator';
  typingDiv.className = 'flex justify-start';
  typingDiv.innerHTML = `
    <div class="bg-gray-100 px-4 py-2 rounded-lg">
      <span class="text-gray-500">입력 중...</span>
    </div>
  `;
  document.getElementById('messages').appendChild(typingDiv);
  scrollToBottom();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, sessionId: 'web-session' })
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let assistantMessage = { role: 'assistant', content: '', timestamp: new Date().toISOString() };

    messages.push(assistantMessage);

    // Remove typing indicator
    const typing = document.getElementById('typing-indicator');
    if (typing) typing.remove();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'text') {
              assistantMessage.content = event.text;
              renderMessages();
              scrollToBottom();
            }
          } catch {}
        }
      }
    }

    // Update history offset (2 new messages added)
    historyOffset += 2;

  } catch (e) {
    console.error('[alter] Send failed:', e);
    messages.push({ role: 'assistant', content: '❌ 오류가 발생했습니다.', timestamp: new Date().toISOString() });
    renderMessages();
  }
}

// Timeline (unified feed) with SSE + Infinite Scroll
let timelineOffset = 0;
let timelineHasMore = true;
let timelineLoading = false;

async function loadTimeline() {
  const container = document.getElementById('timeline-list');
  if (!container) return;

  timelineOffset = 0;
  timelineHasMore = true;
  container.innerHTML = '<p class="text-gray-500 text-sm">Loading...</p>';

  // Initial load
  try {
    const res = await fetch('/api/timeline?limit=30&offset=0');
    const items = await res.json();

    if (items.length < 30) timelineHasMore = false;
    timelineOffset = items.length;

    container.innerHTML = items.length === 0
      ? '<p class="text-gray-500 text-sm text-center py-8">No activity yet</p>'
      : items.map(item => renderTimelineItem(item)).join('');
  } catch (e) {
    console.error('[alter] Timeline initial load failed:', e);
    container.innerHTML = '<p class="text-gray-500 text-sm">Failed to load</p>';
    return;
  }

  // Setup SSE for realtime updates
  if (timelineSSE) timelineSSE.close();

  timelineSSE = new EventSource('/api/timeline/stream');

  timelineSSE.onmessage = (event) => {
    try {
      const item = JSON.parse(event.data);
      const itemId = `timeline-${item.type}-${item.id}`;
      if (document.getElementById(itemId)) return;

      const div = document.createElement('div');
      div.innerHTML = renderTimelineItem(item);
      const element = div.firstElementChild;

      element.id = itemId;
      element.style.opacity = '0';
      element.style.transform = 'translateY(-10px)';

      // Remove "no activity" message if exists
      const noActivity = container.querySelector('p');
      if (noActivity) noActivity.remove();

      container.insertBefore(element, container.firstChild);

      // Fade in animation
      setTimeout(() => {
        element.style.transition = 'opacity 0.3s, transform 0.3s';
        element.style.opacity = '1';
        element.style.transform = 'translateY(0)';
      }, 10);

      timelineOffset++;
    } catch (e) {
      console.error('[alter] Timeline SSE error:', e);
    }
  };

  // Setup infinite scroll
  const view = document.getElementById('view-timeline');
  view.onscroll = async () => {
    if (timelineLoading || !timelineHasMore) return;
    if (view.scrollTop + view.clientHeight >= view.scrollHeight - 200) {
      await loadMoreTimeline();
    }
  };
}

async function loadMoreTimeline() {
  if (timelineLoading || !timelineHasMore) return;
  timelineLoading = true;

  const container = document.getElementById('timeline-list');
  try {
    const res = await fetch(`/api/timeline?limit=30&offset=${timelineOffset}`);
    const items = await res.json();

    if (items.length < 30) timelineHasMore = false;
    timelineOffset += items.length;

    items.forEach(item => {
      container.insertAdjacentHTML('beforeend', renderTimelineItem(item));
    });
  } catch (e) {
    console.error('[alter] Load more timeline failed:', e);
  } finally {
    timelineLoading = false;
  }
}

function renderTimelineItem(item) {
      const time = new Date(item.timestamp).toLocaleString('ko-KR', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });

  // Type-specific rendering
  if (item.type === 'thought') {
    return `
          <div class="bg-blue-50 border-l-4 border-blue-400 p-4 rounded-r-lg hover:bg-blue-100 transition">
            <div class="flex items-start gap-3">
              <div class="text-2xl">💭</div>
              <div class="flex-1">
                <div class="flex justify-between items-start mb-1">
                  <div class="font-semibold text-blue-700">Thought</div>
                  <div class="text-xs text-gray-500">${time}</div>
                </div>
                <div class="text-sm text-gray-800 mb-1">${escapeHtml(item.summary || item.content.slice(0, 100))}</div>
                ${item.metadata ? `<div class="text-xs text-gray-500">#${item.metadata}</div>` : ''}
              </div>
            </div>
          </div>
        `;
      } else if (item.type === 'knowledge') {
        const importance = item.importance || 5;
        const stars = '⭐'.repeat(Math.min(importance, 10));
        return `
          <div class="bg-green-50 border-l-4 border-green-500 p-4 rounded-r-lg hover:bg-green-100 transition">
            <div class="flex items-start gap-3">
              <div class="text-2xl">📚</div>
              <div class="flex-1">
                <div class="flex justify-between items-start mb-1">
                  <div class="font-semibold text-green-700">Knowledge</div>
                  <div class="text-xs text-gray-500">${time}</div>
                </div>
                <div class="text-sm text-gray-800 mb-1">${escapeHtml(item.summary || item.content.slice(0, 100))}</div>
                <div class="flex gap-2 text-xs text-gray-500">
                  ${item.metadata ? `<span>Source: ${item.metadata}</span>` : ''}
                  <span>${stars}</span>
                </div>
              </div>
            </div>
          </div>
        `;
      } else if (item.type === 'task') {
        const statusColors = {
          completed: 'bg-green-100 text-green-800',
          running: 'bg-yellow-100 text-yellow-800',
          failed: 'bg-red-100 text-red-800',
          stuck: 'bg-orange-100 text-orange-800'
        };
        const statusColor = statusColors[item.status] || 'bg-gray-100 text-gray-800';

        return `
          <div class="bg-yellow-50 border-l-4 border-yellow-500 p-4 rounded-r-lg hover:bg-yellow-100 transition">
            <div class="flex items-start gap-3">
              <div class="text-2xl">🛠️</div>
              <div class="flex-1">
                <div class="flex justify-between items-start mb-1">
                  <div class="font-semibold text-yellow-700">Task</div>
                  <div class="text-xs text-gray-500">${time}</div>
                </div>
                <div class="text-sm text-gray-800 mb-1">${escapeHtml(item.content.slice(0, 100))}</div>
                <div class="flex gap-2 text-xs">
                  <span class="px-2 py-1 rounded ${statusColor}">${item.status}</span>
                  ${item.metadata ? `<span class="text-gray-500">Session: ${item.metadata.slice(0, 8)}</span>` : ''}
                </div>
              </div>
            </div>
          </div>
        `;
  }
  return '';
}

// SSE connections for each view
let timelineSSE = null;
let thoughtsSSE = null;
let tasksSSE = null;
let memorySSE = null;
let statsSSE = null;

// Thoughts with SSE + Infinite Scroll
let thoughtsOffset = 0;
let thoughtsHasMore = true;
let thoughtsLoading = false;

async function loadThoughts() {
  const container = document.getElementById('thoughts-list');
  if (!container) return;

  thoughtsOffset = 0;
  thoughtsHasMore = true;
  container.innerHTML = '<p class="text-gray-500 text-sm">Loading...</p>';

  // Initial load
  try {
    const res = await fetch('/api/thoughts?limit=20&offset=0');
    const thoughts = await res.json();

    if (thoughts.length < 20) thoughtsHasMore = false;
    thoughtsOffset = thoughts.length;

    container.innerHTML = thoughts.map(renderThought).join('');
  } catch (e) {
    console.error('[alter] Thoughts initial load failed:', e);
    container.innerHTML = '<p class="text-gray-500 text-sm">Failed to load</p>';
    return;
  }

  // Setup SSE for new thoughts
  if (thoughtsSSE) thoughtsSSE.close();

  thoughtsSSE = new EventSource('/api/thoughts/stream');
  thoughtsSSE.onmessage = (event) => {
    try {
      const thought = JSON.parse(event.data);
      const thoughtId = `thought-${thought.id}`;
      if (document.getElementById(thoughtId)) return;

      const div = document.createElement('div');
      div.innerHTML = renderThought(thought);
      const el = div.firstElementChild;
      el.id = thoughtId;
      el.style.opacity = '0';
      el.style.transform = 'translateY(-10px)';

      container.insertBefore(el, container.firstChild);

      setTimeout(() => {
        el.style.transition = 'opacity 0.3s, transform 0.3s';
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      }, 10);

      thoughtsOffset++;
    } catch (e) {
      console.error('[alter] Thoughts SSE error:', e);
    }
  };

  // Setup infinite scroll
  const view = document.getElementById('view-thoughts');
  view.onscroll = async () => {
    if (thoughtsLoading || !thoughtsHasMore) return;
    if (view.scrollTop + view.clientHeight >= view.scrollHeight - 200) {
      await loadMoreThoughts();
    }
  };
}

async function loadMoreThoughts() {
  if (thoughtsLoading || !thoughtsHasMore) return;
  thoughtsLoading = true;

  const container = document.getElementById('thoughts-list');
  try {
    const res = await fetch(`/api/thoughts?limit=20&offset=${thoughtsOffset}`);
    const thoughts = await res.json();

    if (thoughts.length < 20) thoughtsHasMore = false;
    thoughtsOffset += thoughts.length;

    thoughts.forEach(t => {
      container.insertAdjacentHTML('beforeend', renderThought(t));
    });
  } catch (e) {
    console.error('[alter] Load more thoughts failed:', e);
  } finally {
    thoughtsLoading = false;
  }
}

function renderThought(t) {
  return `
    <div id="thought-${t.id}" class="bg-white p-4 rounded-lg border">
      <div class="text-xs text-gray-500 mb-1">${new Date(t.created_at).toLocaleString('ko-KR')}</div>
      <div class="font-medium text-blue-600 mb-2">${escapeHtml(t.summary || 'Thinking...')}</div>
      <div class="text-sm text-gray-700">${escapeHtml((t.content || '').slice(0, 200))}${(t.content || '').length > 200 ? '...' : ''}</div>
      ${t.category ? `<div class="text-xs text-gray-400 mt-2">#${t.category}</div>` : ''}
    </div>
  `;
}

// Memory
let lastMemoryData = null;
async function loadMemory() {
  const container = document.getElementById('memory-list');
  if (!container) return;

  try {
    const res = await fetch('/api/memory');
    const memories = await res.json();

    // Only update DOM if data changed
    const newData = JSON.stringify(memories);
    if (newData === lastMemoryData) return;
    lastMemoryData = newData;

    const html = memories.map(m => `
      <div class="bg-white p-3 rounded border">
        <div class="font-medium">${escapeHtml(m.key)}</div>
        <div class="text-sm text-gray-600">${escapeHtml(m.value)}</div>
        <div class="text-xs text-gray-400 mt-1">${m.category}</div>
      </div>
    `).join('');

    container.style.opacity = '0.7';
    setTimeout(() => {
      container.innerHTML = html;
      container.style.opacity = '1';
    }, 100);
  } catch (e) {
    console.error('[alter] Memory load failed:', e);
  }
}

// Tasks with Infinite Scroll
let tasksOffset = 0;
let tasksHasMore = true;
let tasksLoading = false;

async function loadTasks() {
  const container = document.getElementById('tasks-list');
  if (!container) return;

  tasksOffset = 0;
  tasksHasMore = true;
  container.innerHTML = '<p class="text-gray-500 text-sm">Loading...</p>';

  try {
    const res = await fetch('/api/tasks?limit=30&offset=0');
    const tasks = await res.json();

    if (tasks.length < 30) tasksHasMore = false;
    tasksOffset = tasks.length;

    container.innerHTML = tasks.map(renderTask).join('');
  } catch (e) {
    console.error('[alter] Tasks load failed:', e);
    container.innerHTML = '<p class="text-gray-500 text-sm">Failed to load</p>';
    return;
  }

  // Setup SSE for new tasks
  if (tasksSSE) tasksSSE.close();

  tasksSSE = new EventSource('/api/tasks/stream');
  tasksSSE.onmessage = (event) => {
    try {
      const task = JSON.parse(event.data);
      const taskId = `task-${task.id}`;
      if (document.getElementById(taskId)) return;

      const div = document.createElement('div');
      div.innerHTML = renderTask(task);
      const el = div.firstElementChild;
      el.id = taskId;
      el.style.opacity = '0';
      el.style.transform = 'translateY(-10px)';

      container.insertBefore(el, container.firstChild);

      setTimeout(() => {
        el.style.transition = 'opacity 0.3s, transform 0.3s';
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      }, 10);

      tasksOffset++;
    } catch (e) {
      console.error('[alter] Tasks SSE error:', e);
    }
  };

  // Setup infinite scroll
  const view = document.getElementById('view-tasks');
  view.onscroll = async () => {
    if (tasksLoading || !tasksHasMore) return;
    if (view.scrollTop + view.clientHeight >= view.scrollHeight - 200) {
      await loadMoreTasks();
    }
  };
}

async function loadMoreTasks() {
  if (tasksLoading || !tasksHasMore) return;
  tasksLoading = true;

  const container = document.getElementById('tasks-list');
  try {
    const res = await fetch(`/api/tasks?limit=30&offset=${tasksOffset}`);
    const tasks = await res.json();

    if (tasks.length < 30) tasksHasMore = false;
    tasksOffset += tasks.length;

    tasks.forEach(t => {
      container.insertAdjacentHTML('beforeend', renderTask(t));
    });
  } catch (e) {
    console.error('[alter] Load more tasks failed:', e);
  } finally {
    tasksLoading = false;
  }
}

function renderTask(t) {
  const statusColor = t.status === 'completed' ? 'bg-green-100 text-green-800' :
                      t.status === 'failed' ? 'bg-red-100 text-red-800' : 'bg-gray-100';
  return `
    <div class="bg-white p-3 rounded border">
      <div class="flex justify-between">
        <div class="font-medium">${escapeHtml(t.description)}</div>
        <span class="text-xs px-2 py-1 rounded ${statusColor}">${t.status}</span>
      </div>
      <div class="text-xs text-gray-500 mt-1">${new Date(t.created_at).toLocaleString('ko-KR')}</div>
    </div>
  `;
}

// Stats
let lastStatsData = null;
async function loadStats() {
  const container = document.getElementById('stats-content');
  if (!container) return;

  try {
    const res = await fetch('/api/stats');
    const stats = await res.json();

    // Compare stats without timestamp field
    const statsForComparison = {...stats};
    delete statsForComparison.timestamp;
    const newData = JSON.stringify(statsForComparison);
    if (newData === lastStatsData) return;
    lastStatsData = newData;

    function formatValue(value) {
      if (typeof value === 'object' && value !== null) {
        return Object.entries(value).map(([k, v]) => {
          // lastRequestTime is absolute timestamp, calculate difference from now
          if (k === 'lastRequestTime') {
            const now = Date.now();
            const diff = now - v;
            const seconds = Math.floor(diff / 1000);
            if (seconds < 60) return `${k}: ${seconds}s ago`;
            const minutes = Math.floor(seconds / 60);
            if (minutes < 60) return `${k}: ${minutes}m ago`;
            const hours = Math.floor(minutes / 60);
            if (hours < 24) return `${k}: ${hours}h ago`;
            const days = Math.floor(hours / 24);
            return `${k}: ${days}d ago`;
          }
          // lastActivity and browserAge are durations in milliseconds
          if (k === 'lastActivity' || k === 'browserAge') {
            const seconds = Math.floor(v / 1000);
            if (seconds < 60) return `${k}: ${seconds}s ago`;
            const minutes = Math.floor(seconds / 60);
            if (minutes < 60) return `${k}: ${minutes}m ago`;
            const hours = Math.floor(minutes / 60);
            return `${k}: ${hours}h ago`;
          }
          // Format boolean values
          if (typeof v === 'boolean') {
            return `${k}: ${v ? '✓' : '✗'}`;
          }
          // Format numbers with commas
          if (typeof v === 'number') {
            return `${k}: ${v.toLocaleString()}`;
          }
          return `${k}: ${v}`;
        }).join('<br>');
      }
      return value;
    }

    const html = Object.entries(stats).map(([key, value]) => `
      <div class="bg-white p-4 rounded border">
        <div class="text-sm text-gray-500 font-semibold mb-2">${key}</div>
        <div class="text-sm text-gray-700">${formatValue(value)}</div>
      </div>
    `).join('');

    container.style.opacity = '0.7';
    setTimeout(() => {
      container.innerHTML = html;
      container.style.opacity = '1';
    }, 100);
  } catch (e) {
    console.error('[alter] Stats load failed:', e);
  }
}

// Utils
function scrollToBottom() {
  const container = document.getElementById('messages');
  setTimeout(() => {
    container.scrollTop = container.scrollHeight;
  }, 0);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderMarkdown(text) {
  if (!text) return '';
  try {
    const html = marked.parse(text);
    setTimeout(() => {
      document.querySelectorAll('pre code').forEach(block => {
        if (!block.dataset.highlighted) {
          hljs.highlightElement(block);
          block.dataset.highlighted = 'true';
        }
      });
    }, 0);
    return html;
  } catch {
    return escapeHtml(text);
  }
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();

  if (date.toDateString() === today.toDateString()) return '오늘';

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return '어제';

  return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

// Auto-refresh using SSE for active view
function startAutoRefresh() {
  // Stats refresh every 5 seconds
  setInterval(() => {
    if (currentView === 'stats' && !document.hidden) loadStats();
  }, 5000);
}
