// Simple server for FLOW kanban - enables Kai interaction
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3456;
const DATA_FILE = path.join(__dirname, 'flow-data.json');

// Default data
const defaultData = {
  boards: [
    {
      id: 'board_1',
      name: 'Flow Mind Website',
      type: 'kanban',
      columns: [
        { id: 'backlog', name: 'Backlog', cards: [] },
        { id: 'todo', name: 'To Do', cards: [] },
        { id: 'inprogress', name: 'In Progress', cards: [] },
        { id: 'done', name: 'Done', cards: [] },
        { id: 'archive', name: 'Archive', cards: [] }
      ]
    },
    {
      id: 'board_2',
      name: 'General',
      type: 'kanban',
      columns: [
        { id: 'backlog', name: 'Backlog', cards: [] },
        { id: 'todo', name: 'To Do', cards: [] },
        { id: 'inprogress', name: 'In Progress', cards: [] },
        { id: 'done', name: 'Done', cards: [] },
        { id: 'archive', name: 'Archive', cards: [] }
      ]
    },
    {
      id: 'board_3',
      name: 'House Keeping',
      type: 'kanban',
      columns: [
        { id: 'backlog', name: 'Backlog', cards: [] },
        { id: 'todo', name: 'To Do', cards: [] },
        { id: 'inprogress', name: 'In Progress', cards: [] },
        { id: 'done', name: 'Done', cards: [] },
        { id: 'archive', name: 'Archive', cards: [] }
      ]
    }
  ],
  archivedCards: [],
  customLabels: [
    { id: 'l1', name: 'feature', color: '#2eaadc' },
    { id: 'l2', name: 'bug', color: '#dc4444' },
    { id: 'l3', name: 'done', color: '#2ecc71' },
    { id: 'l4', name: 'high', color: '#dc4444' },
    { id: 'l5', name: 'mind', color: '#f5a623' },
    { id: 'l6', name: 'flow', color: '#9b59b6' }
  ],
  settings: { currentBoard: 'board_1' },
  lastModified: new Date().toISOString(),
  modifiedBy: 'system'
};

// Load or create data file
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      console.log('Loaded data from', DATA_FILE);
      return data;
    }
  } catch (e) {
    console.error('Error loading data:', e);
  }
  console.log('Creating default data');
  saveData(defaultData);
  return defaultData;
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Load messages from OpenClaw sessions
const syncMessagesFromSessions = async () => {
  try {
    const sessionsPath = path.join(process.env.HOME, '.openclaw/agents/main/sessions');
    const messagesPath = path.join(__dirname, 'data', 'messages.json');
    
    let data = { messages: [], channels: [], lastUpdated: new Date().toISOString() };
    if (fs.existsSync(messagesPath)) {
      data = JSON.parse(fs.readFileSync(messagesPath, 'utf8'));
    }
    
    // Track existing message IDs to avoid duplicates
    const existingIds = new Set(data.messages.map(m => m.id));
    
    // Read session files
    if (fs.existsSync(sessionsPath)) {
      const files = fs.readdirSync(sessionsPath).filter(f => f.endsWith('.jsonl'));
      
      for (const file of files) {
        const sessionId = file.replace('.jsonl', '');
        const content = fs.readFileSync(path.join(sessionsPath, file), 'utf8');
        const lines = content.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry.type === 'message' && entry.message) {
              const msg = entry.message;
              
              // Only process user and assistant messages
              if (msg.role === 'user' || msg.role === 'assistant') {
                const messageId = entry.id || `msg_${entry.timestamp}`;
                
                // Skip if already exists
                if (existingIds.has(messageId)) continue;
                
                // Extract text content
                let text = '';
                if (typeof msg.content === 'string') {
                  text = msg.content;
                } else if (Array.isArray(msg.content)) {
                  text = msg.content
                    .filter(c => c.type === 'text')
                    .map(c => c.text)
                    .join('\n');
                }
                
                // Skip system/heartbeat messages
                if (text.includes('HEARTBEAT_OK') || text.includes('[cron:')) continue;
                
                // Detect channel from content
                let channel = 'flowchat';
                let channelName = 'FlowChat';
                
                if (text.includes('[Telegram') || text.includes('telegram')) {
                  channel = 'telegram';
                  channelName = 'Telegram';
                }
                
                // Clean up the text
                text = text
                  .replace(/\[Telegram.*?\]\s*/, '')
                  .replace(/\[message_id:\s*\d+\]\s*/, '')
                  .replace(/\[Queued messages.*?\]\s*/s, '')
                  .replace(/System:\s*\[.*?\]\s*Cron:.*?(?=\n|$)/, '')
                  .trim();
                
                if (text.length < 3) continue; // Skip very short messages
                
                data.messages.push({
                  id: messageId,
                  channel: channel,
                  channelName: channelName,
                  sender: msg.role === 'user' ? 'Pete' : 'Kai',
                  senderType: msg.role === 'user' ? 'human' : 'ai',
                  text: text.substring(0, 1000), // Limit length
                  timestamp: entry.timestamp || new Date().toISOString(),
                  sessionId: sessionId
                });
                
                existingIds.add(messageId);
              }
            }
          } catch (e) {
            // Skip malformed lines
          }
        }
      }
    }
    
    // Sort by timestamp
    data.messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    // Keep only last 500 messages
    if (data.messages.length > 500) {
      data.messages = data.messages.slice(-500);
    }
    
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(messagesPath, JSON.stringify(data, null, 2));
    
  } catch (e) {
    console.error('Error syncing messages:', e);
  }
};

// ==========================================
// CROSS-MODULE EVENT BUS
// ==========================================

const EventBus = {
  events: {},
  
  // Subscribe to an event
  on(event, callback) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(callback);
  },
  
  // Emit an event
  emit(event, data) {
    if (this.events[event]) {
      this.events[event].forEach(callback => callback(data));
    }
    // Also save to event log for persistence
    logEvent(event, data);
  }
};

// Event logging for cross-module persistence
const logEvent = (eventType, data) => {
  try {
    const eventsPath = path.join(__dirname, 'data', 'events.json');
    let events = { items: [], lastUpdated: new Date().toISOString() };
    
    if (fs.existsSync(eventsPath)) {
      events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
    }
    
    events.items.push({
      id: 'evt_' + Date.now(),
      type: eventType,
      data: data,
      timestamp: new Date().toISOString()
    });
    
    // Keep only last 100 events
    if (events.items.length > 100) {
      events.items = events.items.slice(-100);
    }
    
    events.lastUpdated = new Date().toISOString();
    fs.writeFileSync(eventsPath, JSON.stringify(events, null, 2));
  } catch (e) {
    console.error('Error logging event:', e);
  }
};

// Cross-module triggers
const setupModuleTriggers = () => {
  // When message is posted in Chat → Add to Activity
  EventBus.on('chat:message', (data) => {
    addActivityItem({
      type: 'chat',
      icon: '💬',
      actor: data.sender,
      actorType: data.senderType || 'human',
      description: data.text.substring(0, 200),
      boardName: data.channel,
      timestamp: new Date().toISOString()
    });
  });
  
  // When task is created in Kanban → Log to Activity
  EventBus.on('kanban:taskCreated', (data) => {
    addActivityItem({
      type: 'task',
      icon: '✅',
      actor: data.creator || 'User',
      actorType: 'human',
      description: `Created task: "${data.title}"`,
      boardName: data.board,
      timestamp: new Date().toISOString()
    });
  });
  
  // When task moves in Kanban → Log to Activity
  EventBus.on('kanban:taskMoved', (data) => {
    addActivityItem({
      type: 'task',
      icon: '📋',
      actor: data.actor || 'User',
      actorType: 'human',
      description: `Moved "${data.title}" to ${data.column}`,
      boardName: data.board,
      timestamp: new Date().toISOString()
    });
  });
  
  // When Kai file is edited → Log to Activity
  EventBus.on('kai:fileEdited', (data) => {
    addActivityItem({
      type: 'system',
      icon: '🌊',
      actor: 'Pete',
      actorType: 'human',
      description: `Edited Kai file: ${data.file}`,
      boardName: 'Kai Profile',
      timestamp: new Date().toISOString()
    });
  });
};

// Add item to activity stream
const addActivityItem = async (item) => {
  try {
    const activityPath = path.join(__dirname, 'data', 'activity.json');
    let activity = { activities: [], lastUpdated: new Date().toISOString() };
    
    if (fs.existsSync(activityPath)) {
      activity = JSON.parse(fs.readFileSync(activityPath, 'utf8'));
    }
    
    activity.activities.unshift({
      id: 'act_' + Date.now(),
      ...item,
      timestamp: new Date().toISOString()
    });
    
    // Keep only last 50 activities
    if (activity.activities.length > 50) {
      activity.activities = activity.activities.slice(0, 50);
    }
    
    activity.lastUpdated = new Date().toISOString();
    fs.writeFileSync(activityPath, JSON.stringify(activity, null, 2));
    
  } catch (e) {
    console.error('Error adding activity:', e);
  }
};

// Initialize triggers
setupModuleTriggers();

// ==========================================
// AUTO-MEMORY EXTRACTION SYSTEM
// ==========================================

const extractMemoryFromFileEdit = (fileName, content) => {
  try {
    const memoryPath = path.join(__dirname, 'data', 'memory.json');
    let memoryData = { memories: [], categories: [], lastUpdated: new Date().toISOString() };
    
    if (fs.existsSync(memoryPath)) {
      memoryData = JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
    }
    
    // Determine category based on file name
    let category = 'system';
    let icon = '📝';
    
    if (fileName.includes('SOUL')) {
      category = 'identity';
      icon = '🌊';
    } else if (fileName.includes('IDENTITY')) {
      category = 'identity';
      icon = '🆔';
    } else if (fileName.includes('USER')) {
      category = 'preference';
      icon = '👤';
    } else if (fileName.includes('MEMORY')) {
      category = 'milestone';
      icon = '🧠';
    } else if (fileName.includes('trading')) {
      category = 'trading';
      icon = '📈';
    } else if (fileName.includes('STRATEGY') || fileName.includes('Business')) {
      category = 'business';
      icon = '💼';
    }
    
    // Create memory entry
    const newMemory = {
      id: 'mem_' + Date.now(),
      type: 'edit',
      content: `Updated ${fileName.replace('.md', '')}`,
      category: category,
      addedBy: 'Pete',
      actorType: 'human',
      timestamp: new Date().toISOString(),
      icon: icon,
      source: 'kai_profile'
    };
    
    // Check for duplicates (same file within last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const isDuplicate = memoryData.memories.some(m => 
      m.source === 'kai_profile' && 
      m.content === newMemory.content &&
      m.timestamp > oneHourAgo
    );
    
    if (!isDuplicate) {
      memoryData.memories.unshift(newMemory);
      
      // Keep only last 50 memories
      if (memoryData.memories.length > 50) {
        memoryData.memories = memoryData.memories.slice(0, 50);
      }
      
      memoryData.lastUpdated = new Date().toISOString();
      fs.writeFileSync(memoryPath, JSON.stringify(memoryData, null, 2));
      console.log('Memory extracted from file edit:', fileName);
    }
  } catch (e) {
    console.error('Error extracting memory:', e);
  }
};

// Parse daily logs and MEMORY.md for auto-extraction
const parseDailyLogsForMemories = () => {
  try {
    const memoryPath = path.join(__dirname, 'data', 'memory.json');
    let memoryData = { memories: [], categories: [], lastUpdated: new Date().toISOString() };
    
    if (fs.existsSync(memoryPath)) {
      memoryData = JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
    }
    
    // Get list of memory files
    const workspacePath = path.join(process.env.HOME, '.openclaw/workspace/memory');
    if (!fs.existsSync(workspacePath)) return;
    
    const files = fs.readdirSync(workspacePath).filter(f => f.endsWith('.md') && f.match(/^\d{2}-\d{2}-\d{4}\.md$/));
    
    // Parse each daily log
    files.forEach(file => {
      const content = fs.readFileSync(path.join(workspacePath, file), 'utf8');
      const date = file.replace('.md', '');
      
      // Extract accomplishments
      const accomplishmentsMatch = content.match(/## Key Accomplishments[\s\S]*?(?=##|$)/);
      if (accomplishmentsMatch) {
        const items = accomplishmentsMatch[0].match(/- \*\*.*?\*\*.*?(?=\n- \*\*|\n###|\n##|$)/gs) || [];
        items.forEach(item => {
          const cleanItem = item.replace(/^- \*\*/, '').replace(/\*\*/g, '').trim();
          if (cleanItem.length > 10 && !cleanItem.includes('None yet') && !memoryData.memories.some(m => m.content === cleanItem)) {
            memoryData.memories.push({
              id: 'mem_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
              type: 'accomplishment',
              content: cleanItem.substring(0, 200),
              category: 'milestone',
              addedBy: 'Kai',
              actorType: 'ai',
              timestamp: new Date().toISOString(),
              icon: '✅',
              source: `daily_log_${date}`
            });
          }
        });
      }
      
      // Extract technical decisions
      const decisionsMatch = content.match(/## Technical Decisions[\s\S]*?(?=##|$)/);
      if (decisionsMatch) {
        const items = decisionsMatch[0].match(/- .*?(?=\n- |\n###|\n##|$)/gs) || [];
        items.forEach(item => {
          const cleanItem = item.replace(/^- /, '').trim();
          if (cleanItem.length > 10 && !cleanItem.includes('None yet') && !cleanItem.startsWith('---') && !memoryData.memories.some(m => m.content === cleanItem)) {
            memoryData.memories.push({
              id: 'mem_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
              type: 'decision',
              content: cleanItem.substring(0, 200),
              category: 'product',
              addedBy: 'Kai',
              actorType: 'ai',
              timestamp: new Date().toISOString(),
              icon: '💡',
              source: `daily_log_${date}`
            });
          }
        });
      }
    });
    
    // Sort by timestamp descending
    memoryData.memories.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Keep only last 50
    if (memoryData.memories.length > 50) {
      memoryData.memories = memoryData.memories.slice(0, 50);
    }
    
    memoryData.lastUpdated = new Date().toISOString();
    fs.writeFileSync(memoryPath, JSON.stringify(memoryData, null, 2));
    console.log('Parsed daily logs for memories, total:', memoryData.memories.length);
    
  } catch (e) {
    console.error('Error parsing daily logs:', e);
  }
};

// Run once on server start
parseDailyLogsForMemories();

// Schedule to run every hour
setInterval(parseDailyLogsForMemories, 60 * 60 * 1000);

// Detect kanban changes and emit events
const detectKanbanChanges = (oldData, newData) => {
  try {
    const oldCards = new Map();
    const newCards = new Map();
    
    // Index old cards
    oldData.boards?.forEach(board => {
      board.columns?.forEach(col => {
        col.cards?.forEach(card => {
          oldCards.set(card.id, { ...card, column: col.id, board: board.name });
        });
      });
    });
    
    // Index new cards
    newData.boards?.forEach(board => {
      board.columns?.forEach(col => {
        col.cards?.forEach(card => {
          newCards.set(card.id, { ...card, column: col.id, board: board.name });
        });
      });
    });
    
    // Check for new cards
    newCards.forEach((card, id) => {
      if (!oldCards.has(id)) {
        EventBus.emit('kanban:taskCreated', {
          id: card.id,
          title: card.title,
          column: card.column,
          board: card.board,
          creator: 'User'
        });
      } else {
        // Check if moved
        const oldCard = oldCards.get(id);
        if (oldCard.column !== card.column) {
          EventBus.emit('kanban:taskMoved', {
            id: card.id,
            title: card.title,
            fromColumn: oldCard.column,
            column: card.column,
            board: card.board,
            actor: 'User'
          });
        }
      }
    });
  } catch (e) {
    console.error('Error detecting kanban changes:', e);
  }
};

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // API endpoints (handle query params by checking startsWith)
  const urlPath = req.url.split('?')[0];
  
  if (urlPath === '/api/data' && req.method === 'GET') {
    const data = loadData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }

  if (urlPath === '/api/activity' && req.method === 'GET') {
    try {
      const activityPath = path.join(__dirname, 'data', 'activity.json');
      if (fs.existsSync(activityPath)) {
        const data = fs.readFileSync(activityPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(data);
        return;
      }
    } catch (e) {
      console.error('Error loading activity:', e);
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Activity data not found' }));
    return;
  }

  if (urlPath === '/api/memory' && req.method === 'GET') {
    try {
      const memoryPath = path.join(__dirname, 'data', 'memory.json');
      if (fs.existsSync(memoryPath)) {
        const data = fs.readFileSync(memoryPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(data);
        return;
      }
    } catch (e) {
      console.error('Error loading memory:', e);
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Memory data not found' }));
    return;
  }

  if (urlPath === '/api/deliverables' && req.method === 'GET') {
    try {
      const deliverablesPath = path.join(__dirname, 'data', 'deliverables.json');
      if (fs.existsSync(deliverablesPath)) {
        const data = fs.readFileSync(deliverablesPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(data);
        return;
      }
    } catch (e) {
      console.error('Error loading deliverables:', e);
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Deliverables data not found' }));
    return;
  }

  // Messages API - Unified chat history
  if (urlPath === '/api/messages' && req.method === 'GET') {
    try {
      // First, sync from OpenClaw sessions
      await syncMessagesFromSessions();
      
      const messagesPath = path.join(__dirname, 'data', 'messages.json');
      if (fs.existsSync(messagesPath)) {
        const data = fs.readFileSync(messagesPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(data);
        return;
      } else {
        // Return empty structure if file doesn't exist
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ messages: [], channels: [], lastUpdated: new Date().toISOString() }));
        return;
      }
    } catch (e) {
      console.error('Error loading messages:', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
      return;
    }
  }

  if (urlPath === '/api/messages' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const messagesPath = path.join(__dirname, 'data', 'messages.json');
        let data = { messages: [], channels: [], lastUpdated: new Date().toISOString() };
        
        if (fs.existsSync(messagesPath)) {
          data = JSON.parse(fs.readFileSync(messagesPath, 'utf8'));
        }
        
        const newMessage = JSON.parse(body);
        newMessage.id = 'msg_' + Date.now();
        newMessage.timestamp = new Date().toISOString();
        
        data.messages.push(newMessage);
        data.lastUpdated = new Date().toISOString();
        
        fs.writeFileSync(messagesPath, JSON.stringify(data, null, 2));
        
        // Emit event for cross-module communication
        EventBus.emit('chat:message', newMessage);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: newMessage }));
      } catch (e) {
        console.error('Error saving message:', e);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Events API - Cross-module event log
  if (urlPath === '/api/events' && req.method === 'GET') {
    try {
      const eventsPath = path.join(__dirname, 'data', 'events.json');
      if (fs.existsSync(eventsPath)) {
        const data = fs.readFileSync(eventsPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(data);
        return;
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ items: [], lastUpdated: new Date().toISOString() }));
        return;
      }
    } catch (e) {
      console.error('Error loading events:', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
      return;
    }
  }

  // Token Usage API - Get session token stats from OpenClaw
  if (urlPath === '/api/tokens' && req.method === 'GET') {
    try {
      const { execSync } = require('child_process');
      const output = execSync('openclaw sessions list 2>/dev/null || echo ""', { encoding: 'utf8', timeout: 5000 });
      
      // Parse session data
      const lines = output.split('\n').filter(l => l.trim() && l.includes('agent:main'));
      const sessions = [];
      let totalTokens = 0;
      let totalContext = 0;
      
      for (const line of lines) {
        // Parse: direct agent:main:main 2m ago k2p5 136k/262k (52%) system id:...
        // Split by multiple spaces but first extract kind and key
        const trimmed = line.trim();
        const kindMatch = trimmed.match(/^(\S+)\s+(agent:main:\S+)/);
        
        if (kindMatch) {
          const kind = kindMatch[1];
          const key = kindMatch[2];
          const rest = trimmed.substring(kindMatch[0].length).trim();
          const parts = rest.split(/\s{2,}/);
          
          const age = parts[0];
          const model = parts[1];
          const tokens = parts[2];
          
          // Skip if no token data (shows "-")
          if (tokens === '-' || !tokens.includes('/')) {
            sessions.push({
              key: key.replace('agent:main:', ''),
              age,
              model,
              tokensUsed: '-',
              tokensTotal: '-',
              percent: 0,
              kind,
              active: false
            });
            continue;
          }
          
          const tokenMatch = tokens.match(/(\d+(?:\.\d+)?k?)\/(\d+(?:\.\d+)?k?)/);
          const percentMatch = line.match(/\((\d+)%\)/);
          
          if (tokenMatch) {
            const [_, used, total] = tokenMatch;
            const percent = percentMatch ? parseInt(percentMatch[1]) : 0;
            
            const usedNum = parseFloat(used.replace('k', '')) * (used.includes('k') ? 1000 : 1);
            const totalNum = parseFloat(total.replace('k', '')) * (total.includes('k') ? 1000 : 1);
            
            sessions.push({
              key: key.replace('agent:main:', ''),
              age,
              model,
              tokensUsed: used,
              tokensTotal: total,
              percent,
              kind,
              active: true
            });
            
            totalTokens += usedNum;
            totalContext += totalNum;
          }
        }
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        sessions,
        summary: {
          totalSessions: sessions.length,
          activeSessions: sessions.filter(s => s.active).length,
          totalTokensUsed: Math.round(totalTokens / 1000) + 'k',
          totalContextWindow: Math.round(totalContext / 1000) + 'k',
          averageUsage: sessions.filter(s => s.active).length > 0 ? 
            Math.round(sessions.filter(s => s.active).reduce((a, s) => a + s.percent, 0) / sessions.filter(s => s.active).length) + '%' : '0%'
        },
        lastUpdated: new Date().toISOString()
      }));
      return;
    } catch (e) {
      console.error('Error loading tokens:', e);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessions: [], summary: {}, error: e.message }));
      return;
    }
  }

  // Module trigger API - Allow modules to emit events
  if (urlPath === '/api/trigger' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { event, data } = JSON.parse(body);
        
        // Validate event type
        const validEvents = ['kanban:taskCreated', 'kanban:taskMoved', 'kai:fileEdited'];
        if (validEvents.includes(event)) {
          EventBus.emit(event, data);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, event }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid event type' }));
        }
      } catch (e) {
        console.error('Error triggering event:', e);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Crons API - Real cron jobs from OpenClaw
  if (urlPath === '/api/crons' && req.method === 'GET') {
    try {
      const { execSync } = require('child_process');
      const output = execSync('openclaw cron list 2>/dev/null || echo ""', { encoding: 'utf8' });
      
      // Parse the fixed-width table output
      const lines = output.split('\n').filter(l => l.trim() && !l.startsWith('ID') && !l.includes('------'));
      const crons = [];
      
      for (const line of lines) {
        // Fixed column positions based on header
        const id = line.substring(0, 36).trim();
        const name = line.substring(37, 61).trim();
        const schedule = line.substring(62, 94).trim();
        const next = line.substring(95, 105).trim();
        const last = line.substring(106, 116).trim();
        const status = line.substring(117, 126).trim();
        const target = line.substring(127, 136).trim();
        const agent = line.substring(137).trim();
        
        if (id && name) {
          crons.push({
            id: id,
            name: name,
            schedule: schedule,
            next: next,
            last: last,
            status: status,
            target: target,
            agent: agent
          });
        }
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ crons, count: crons.length }));
      return;
    } catch (e) {
      console.error('Error loading crons:', e);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ crons: [], count: 0, error: e.message }));
      return;
    }
  }

  // Channels API - Real channel status from OpenClaw
  if (urlPath === '/api/channels' && req.method === 'GET') {
    try {
      const configPath = path.join(process.env.HOME, '.openclaw/openclaw.json');
      let channels = [];
      
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        
        // Extract channel status from config
        if (config.channels) {
          for (const [name, settings] of Object.entries(config.channels)) {
            channels.push({
              name: name,
              enabled: settings.enabled || false,
              status: settings.enabled ? 'connected' : 'disabled'
            });
          }
        }
        
        // Add webchat if sessions exist
        const sessionsPath = path.join(process.env.HOME, '.openclaw/agents/main/sessions');
        if (fs.existsSync(sessionsPath)) {
          channels.push({
            name: 'flowchat',
            enabled: true,
            status: 'active'
          });
        }
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ channels }));
      return;
    } catch (e) {
      console.error('Error loading channels:', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ channels: [], error: e.message }));
      return;
    }
  }

  // Memory Refresh API - Force re-parse daily logs
  if (urlPath === '/api/memory/refresh' && req.method === 'POST') {
    try {
      parseDailyLogsForMemories();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Memory refresh triggered' }));
      return;
    } catch (e) {
      console.error('Error refreshing memories:', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
      return;
    }
  }

  // Workspace .md files API
  if (urlPath.startsWith('/api/workspace/') && req.method === 'GET') {
    try {
      const fileName = urlPath.replace('/api/workspace/', '');
      // Security: only allow .md files, no directory traversal
      if (!fileName.endsWith('.md') || fileName.includes('..') || fileName.includes('/')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid file name' }));
        return;
      }
      const workspacePath = path.join(process.env.HOME, '.openclaw/workspace', fileName);
      if (fs.existsSync(workspacePath)) {
        const content = fs.readFileSync(workspacePath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ content }));
        return;
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File not found' }));
        return;
      }
    } catch (e) {
      console.error('Error loading workspace file:', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
      return;
    }
  }

  if (urlPath.startsWith('/api/workspace/') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const fileName = urlPath.replace('/api/workspace/', '');
        // Security: only allow .md files, no directory traversal
        if (!fileName.endsWith('.md') || fileName.includes('..') || fileName.includes('/')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid file name' }));
          return;
        }
        const { content } = JSON.parse(body);
        const workspacePath = path.join(process.env.HOME, '.openclaw/workspace', fileName);
        fs.writeFileSync(workspacePath, content, 'utf8');
        
        // Emit event for cross-module communication
        EventBus.emit('kai:fileEdited', { file: fileName });
        
        // Auto-extract memory from file edit
        extractMemoryFromFileEdit(fileName, content);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        console.error('Error saving workspace file:', e);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (urlPath === '/api/data' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        data.lastModified = new Date().toISOString();
        data.modifiedBy = 'user';
        
        // Load OLD data BEFORE saving for comparison
        const oldData = loadData();
        
        saveData(data);
        
        // Detect changes for activity logging
        detectKanbanChanges(oldData, data);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Gateway Status API
  if (urlPath === '/api/gateway/status' && req.method === 'GET') {
    try {
      const { execSync } = require('child_process');
      const output = execSync('openclaw status 2>/dev/null || echo "Gateway not running"', { encoding: 'utf8', timeout: 5000 });
      
      // Parse status output
      const status = {
        running: output.includes('Gateway') && !output.includes('not running'),
        dashboard: 'http://127.0.0.1:18789/',
        reachable: null,
        sessions: 0,
        version: null,
        raw: output
      };
      
      // Extract reachable time
      const reachableMatch = output.match(/reachable\s+(\d+)ms/);
      if (reachableMatch) status.reachable = parseInt(reachableMatch[1]);
      
      // Extract session count
      const sessionsMatch = output.match(/sessions\s+(\d+)/);
      if (sessionsMatch) status.sessions = parseInt(sessionsMatch[1]);
      
      // Extract version
      const versionMatch = output.match(/node\s+([\d.]+)/);
      if (versionMatch) status.version = versionMatch[1];
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ running: false, error: e.message }));
      return;
    }
  }

  // Gateway Restart API
  if (urlPath === '/api/gateway/restart' && req.method === 'POST') {
    try {
      const { exec } = require('child_process');
      
      // Restart gateway in background
      exec('openclaw gateway restart 2>&1 &', (error, stdout, stderr) => {
        if (error) {
          console.error('Gateway restart error:', error);
        } else {
          console.log('Gateway restart initiated:', stdout);
        }
      });
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Gateway restart initiated' }));
      return;
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: e.message }));
      return;
    }
  }

  // Static files
  let filePath = req.url;
  
  // Route mapping
  if (req.url === '/' || req.url === '/dashboard') {
    filePath = '/dashboard.html';
  } else if (req.url === '/kanban' || req.url === '/kanban.html') {
    filePath = '/kanban.html';
  }
  
  const fullPath = path.join(__dirname, 'app', filePath);
  
  try {
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath);
      const ext = path.extname(fullPath);
      const contentType = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json'
      }[ext] || 'text/plain';
      
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
      return;
    }
  } catch (e) {
    console.error('Error serving file:', e);
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`FLOW server running at http://localhost:${PORT}`);
  console.log('Data file:', DATA_FILE);
  console.log('');
  console.log('Kai can now:');
  console.log('1. Read/write flow-data.json directly');
  console.log('2. Call API at http://localhost:${PORT}/api/data');
});
