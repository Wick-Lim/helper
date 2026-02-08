// Alpine.js App - Agent WebUI
// Main application logic

document.addEventListener('alpine:init', () => {
  Alpine.data('app', () => ({
    // State
    currentView: 'chat',
    sessionId: '',
    isConnected: false,
    
    // Chat
    messages: [],
    chatInput: '',
    isTyping: false,
    selectedFile: null,
    eventSource: null,
    
    // Memory
    memories: [],
    filteredMemories: [],
    memorySearch: '',
    memoryCategory: '',
    showAddMemory: false,
    editingMemory: null,
    memoryForm: { key: '', value: '', category: 'general' },
    
    // Tasks
    tasks: [],
    selectedTask: null,
    
    // Dashboard
    stats: {},
    apiChart: null,
    toolChart: null,
    
    // Settings
    config: {
      model: 'gemini-2.5-flash',
      temperature: 0.7,
      max_iterations: 100,
      tool_timeout_ms: 30000,
      verbose: false
    },
    isSaving: false,
    
    // Init
    init() {
      this.sessionId = this.generateSessionId();
      this.checkConnection();
      this.loadMemories();
      this.loadTasks();
      this.loadConfig();
      this.loadStats();
      
      // Auto-refresh tasks when viewing
      setInterval(() => {
        if (this.currentView === 'tasks') this.loadTasks();
        if (this.currentView === 'dashboard') this.loadStats();
      }, 5000);
    },
    
    generateSessionId() {
      return 'webui-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    },
    
    // Connection
    async checkConnection() {
      try {
        const res = await fetch('/api/health');
        this.isConnected = res.ok;
      } catch {
        this.isConnected = false;
      }
    },
    
    // Chat Functions
    async sendMessage() {
      if (!this.chatInput.trim() && !this.selectedFile) return;
      
      const userMessage = this.chatInput.trim();
      this.chatInput = '';
      
      // Add user message
      this.messages.push({
        role: 'user',
        content: userMessage,
        timestamp: new Date()
      });
      
      this.isTyping = true;
      this.scrollToBottom();
      
      // Prepare request
      const body = {
        message: userMessage,
        sessionId: this.sessionId
      };
      
      if (this.selectedFile) {
        const base64 = await this.fileToBase64(this.selectedFile);
        body.images = [{
          mimeType: this.selectedFile.type,
          data: base64.split(',')[1]
        }];
        this.selectedFile = null;
      }
      
      try {
        // Use SSE for streaming
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentContent = '';
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                this.handleStreamEvent(data, currentContent);
                if (data.text) currentContent = data.text;
              } catch (e) {
                // Ignore parse errors
              }
            }
          }
        }
      } catch (error) {
        this.messages.push({
          role: 'assistant',
          content: '❌ 오류: ' + error.message,
          timestamp: new Date()
        });
      } finally {
        this.isTyping = false;
        this.scrollToBottom();
      }
    },
    
    handleStreamEvent(data, currentContent) {
      if (data.type === 'text') {
        // Update or add assistant message
        const lastMsg = this.messages[this.messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.done) {
          lastMsg.content = data.text;
        } else {
          this.messages.push({
            role: 'assistant',
            content: data.text,
            timestamp: new Date(),
            done: false
          });
        }
        this.scrollToBottom();
      } else if (data.type === 'tool_call') {
        // Show tool call
        this.messages.push({
          role: 'tool',
          content: `🔧 ${data.name} 실행 중...`,
          timestamp: new Date()
        });
        this.scrollToBottom();
      } else if (data.type === 'tool_result') {
        // Update tool result
        const lastMsg = this.messages[this.messages.length - 1];
        if (lastMsg && lastMsg.role === 'tool') {
          lastMsg.content = `✅ ${data.name} 완료`;
          lastMsg.result = data.result;
        }
      } else if (data.type === 'done') {
        const lastMsg = this.messages[this.messages.length - 1];
        if (lastMsg) lastMsg.done = true;
      } else if (data.type === 'error') {
        this.messages.push({
          role: 'assistant',
          content: '❌ 오류: ' + data.error,
          timestamp: new Date(),
          done: true
        });
      }
    },
    
    handleFileUpload(event) {
      const file = event.target.files[0];
      if (file && file.type.startsWith('image/')) {
        this.selectedFile = file;
      }
    },
    
    fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    },
    
    scrollToBottom() {
      this.$nextTick(() => {
        const container = this.$refs.chatMessages;
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      });
    },
    
    renderMarkdown(content) {
      if (!content) return '';
      const html = marked.parse(content);
      this.$nextTick(() => {
        document.querySelectorAll('pre code').forEach((block) => {
          hljs.highlightBlock(block);
        });
      });
      return html;
    },
    
    // Memory Functions
    async loadMemories() {
      try {
        const res = await fetch('/api/memory');
        this.memories = await res.json();
        this.filterMemories();
      } catch (error) {
        console.error('Failed to load memories:', error);
      }
    },
    
    filterMemories() {
      let filtered = this.memories;
      
      if (this.memorySearch) {
        const search = this.memorySearch.toLowerCase();
        filtered = filtered.filter(m => 
          m.key.toLowerCase().includes(search) || 
          m.value.toLowerCase().includes(search)
        );
      }
      
      if (this.memoryCategory) {
        filtered = filtered.filter(m => m.category === this.memoryCategory);
      }
      
      this.filteredMemories = filtered;
    },
    
    searchMemories() {
      this.filterMemories();
    },
    
    editMemory(memory) {
      this.editingMemory = memory;
      this.memoryForm = {
        key: memory.key,
        value: memory.value,
        category: memory.category
      };
    },
    
    async saveMemory() {
      try {
        if (this.editingMemory) {
          await fetch(`/api/memory/${this.editingMemory.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.memoryForm)
          });
        } else {
          await fetch('/api/memory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.memoryForm)
          });
        }
        
        this.cancelMemoryEdit();
        this.loadMemories();
      } catch (error) {
        alert('저장 실패: ' + error.message);
      }
    },
    
    async deleteMemory(id) {
      if (!confirm('정말 삭제하시겠습니까?')) return;
      
      try {
        await fetch(`/api/memory/${id}`, { method: 'DELETE' });
        this.loadMemories();
      } catch (error) {
        alert('삭제 실패: ' + error.message);
      }
    },
    
    cancelMemoryEdit() {
      this.showAddMemory = false;
      this.editingMemory = null;
      this.memoryForm = { key: '', value: '', category: 'general' };
    },
    
    // Task Functions
    async loadTasks() {
      try {
        const res = await fetch('/api/tasks');
        this.tasks = await res.json();
      } catch (error) {
        console.error('Failed to load tasks:', error);
      }
    },
    
    showTaskDetail(task) {
      this.selectedTask = task;
    },
    
    // Dashboard Functions
    async loadStats() {
      try {
        const res = await fetch('/api/stats');
        this.stats = await res.json();
        this.updateCharts();
      } catch (error) {
        console.error('Failed to load stats:', error);
      }
    },
    
    calculateSuccessRate() {
      if (!this.stats.totalRequests) return 0;
      const success = this.stats.totalRequests - this.stats.errors;
      return Math.round((success / this.stats.totalRequests) * 100);
    },
    
    getUniqueCategories() {
      const categories = new Set(this.memories.map(m => m.category));
      return Array.from(categories);
    },
    
    updateCharts() {
      // API Usage Chart
      if (this.apiChart) this.apiChart.destroy();
      const apiCtx = document.getElementById('apiChart');
      if (apiCtx) {
        this.apiChart = new Chart(apiCtx, {
          type: 'line',
          data: {
            labels: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'],
            datasets: [{
              label: 'API Calls',
              data: [12, 19, 8, 25, 15, 20],
              borderColor: 'rgb(59, 130, 246)',
              tension: 0.4
            }]
          },
          options: {
            responsive: true,
            plugins: { legend: { display: false } }
          }
        });
      }
      
      // Tool Usage Chart
      if (this.toolChart) this.toolChart.destroy();
      const toolCtx = document.getElementById('toolChart');
      if (toolCtx) {
        this.toolChart = new Chart(toolCtx, {
          type: 'doughnut',
          data: {
            labels: ['shell', 'file', 'web', 'code', 'memory', 'browser'],
            datasets: [{
              data: [30, 25, 20, 10, 10, 5],
              backgroundColor: [
                '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'
              ]
            }]
          },
          options: {
            responsive: true,
            plugins: { legend: { position: 'bottom' } }
          }
        });
      }
    },
    
    // Settings Functions
    async loadConfig() {
      try {
        const res = await fetch('/api/config');
        const config = await res.json();
        this.config = { ...this.config, ...config };
      } catch (error) {
        console.error('Failed to load config:', error);
      }
    },
    
    async saveConfig() {
      this.isSaving = true;
      try {
        await fetch('/api/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.config)
        });
        alert('설정이 저장되었습니다');
      } catch (error) {
        alert('저장 실패: ' + error.message);
      } finally {
        this.isSaving = false;
      }
    },
    
    // Utilities
    formatTime(date) {
      if (!date) return '';
      const d = new Date(date);
      return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    },
    
    formatDate(date) {
      if (!date) return '';
      const d = new Date(date);
      return d.toLocaleDateString('ko-KR', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  }));
});
