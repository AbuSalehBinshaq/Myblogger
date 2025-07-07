const express = require('express');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const { google } = require('googleapis');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Sessions
app.use(session({
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
  store: new MemoryStore({ checkPeriod: 86400000 }),
  secret: 'supersecretkey',
  resave: false,
  saveUninitialized: true
}));

// === فحص المتغيرات ===
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

console.log('-------------------------------------');
console.log('✅ فحص متغيرات البيئة');
console.log('CLIENT_ID:', CLIENT_ID || '❌ مفقود');
console.log('CLIENT_SECRET:', CLIENT_SECRET || '❌ مفقود');
console.log('REDIRECT_URI:', REDIRECT_URI || '❌ مفقود');
console.log('-------------------------------------');

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
  console.error('❌ خطأ: في متغيرات مفقودة في .env أو في إعدادات Render!');
}

// OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

const SCOPES = ['https://www.googleapis.com/auth/blogger'];

// Helpers
function setCredentialsFromSession(req) {
  const creds = req.session.credentials;
  if (!creds) return false;
  oauth2Client.setCredentials(creds);
  return true;
}

function getBloggerService() {
  return google.blogger({ version: 'v3', auth: oauth2Client });
}

function extractFirstImage(html) {
  const imgMatch = html.match(/<img[^>]+src="([^">]+)"/i);
  return imgMatch ? imgMatch[1] : null;
}

// ===== Routes =====

app.get('/', (req, res) => {
  if (!req.session.credentials) return res.render('login');
  res.redirect('/blogs');
});

app.get('/login', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });
  console.log('[GET /login] Redirecting to:', authUrl);
  res.redirect(authUrl);
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect('/');

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    req.session.credentials = tokens;
    res.redirect('/blogs');
  } catch (error) {
    console.error('[OAuth Error]', error);
    res.send('Authentication failed.');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/blogs', async (req, res) => {
  if (!setCredentialsFromSession(req)) return res.redirect('/');

  try {
    const blogger = getBloggerService();
    const response = await blogger.blogs.listByUser({ userId: 'self' });
    const blogs = response.data.items || [];
    res.render('blogs', { blogs });
  } catch (error) {
    console.error('[Error fetching blogs]', error);
    res.send('Error fetching blogs.');
  }
});

app.get('/posts/:blogId', async (req, res) => {
  if (!setCredentialsFromSession(req)) return res.redirect('/');

  const blogId = req.params.blogId;
  try {
    const blogger = getBloggerService();
    const response = await blogger.posts.list({ blogId, status: 'draft' });
    const posts = (response.data.items || []).map(post => ({
      id: post.id,
      title: post.title,
      content: post.content,
      firstImage: extractFirstImage(post.content)
    }));
    res.render('posts', { posts, blogId });
  } catch (error) {
    console.error('[Error fetching posts]', error);
    res.send('Error fetching posts.');
  }
});

app.get('/publish/:blogId/:postId', async (req, res) => {
  if (!setCredentialsFromSession(req)) return res.redirect('/');
  const { blogId, postId } = req.params;

  try {
    const blogger = getBloggerService();
    await blogger.posts.publish({ blogId, postId });
    res.redirect(`/posts/${blogId}`);
  } catch (error) {
    console.error('[Error publishing post]', error);
    res.send('Error publishing post.');
  }
});

app.get('/delete/:blogId/:postId', async (req, res) => {
  if (!setCredentialsFromSession(req)) return res.redirect('/');
  const { blogId, postId } = req.params;

  try {
    const blogger = getBloggerService();
    await blogger.posts.delete({ blogId, postId });
    res.redirect(`/posts/${blogId}`);
  } catch (error) {
    console.error('[Error deleting post]', error);
    res.send('Error deleting post.');
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});