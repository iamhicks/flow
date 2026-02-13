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

const server = http.createServer((req, res) => {
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
        saveData(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
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
