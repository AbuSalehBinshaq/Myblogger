const express = require('express');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const { google } = require('googleapis');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Static files (CSS)
app.use(express.static(path.join(__dirname, 'public')));

// View engine setup (EJS)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session setup - keep login for 7 days
app.use(session({
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
  store: new MemoryStore({
    checkPeriod: 86400000 // prune expired entries every 24h
  }),
  secret: 'supersecretkey',
  resave: false,
  saveUninitialized: true
}));

// Load credentials.json content (put your credentials.json file in the project root)
const CREDENTIALS = require('./credentials.json');

const SCOPES = ['https://www.googleapis.com/auth/blogger'];
const CLIENT_ID = CREDENTIALS.web.client_id;
const CLIENT_SECRET = CREDENTIALS.web.client_secret;
const REDIRECT_URI = CREDENTIALS.web.redirect_uris[0];

// OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

// Helper: convert session credentials to OAuth2 client
function setCredentialsFromSession(req) {
  const creds = req.session.credentials;
  if (!creds) return false;
  oauth2Client.setCredentials(creds);
  return true;
}

// Helper: build Blogger service with auth
function getBloggerService() {
  return google.blogger({ version: 'v3', auth: oauth2Client });
}

// Helper: Extract first image from post content (simple regex)
function extractFirstImage(html) {
  const imgMatch = html.match(/<img[^>]+src="([^">]+)"/i);
  return imgMatch ? imgMatch[1] : null;
}

// Helper: Rebuild URL with port if missing
function urlWithPort(req, path) {
  const host = req.hostname;
  const port = PORT;
  return `http://${host}:${port}${path}`;
}

// ===== Routes =====

// Home / Index
app.get('/', (req, res) => {
  if (!req.session.credentials) {
    console.log('[GET /] No credentials, rendering login page');
    return res.render('login');
  }
  console.log('[GET /] Logged in, redirecting to /blogs');
  res.redirect('/blogs');
});

// Login route - redirect to Google OAuth consent screen
app.get('/login', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });
  console.log('[GET /login] Redirecting to Google OAuth consent');
  res.redirect(authUrl);
});

// OAuth2 callback route
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    console.log('[GET /callback] No code query param');
    return res.redirect('/');
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    req.session.credentials = tokens;
    console.log('[GET /callback] OAuth2 login successful, tokens saved in session');
    res.redirect('/blogs');
  } catch (error) {
    console.error('[GET /callback] Error retrieving tokens:', error);
    res.send('Authentication failed. Please try again.');
  }
});

// Logout route - destroy session
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    console.log('[GET /logout] Session destroyed, user logged out');
    res.redirect('/');
  });
});

// List blogs
app.get('/blogs', async (req, res) => {
  if (!setCredentialsFromSession(req)) {
    console.log('[GET /blogs] No credentials in session, redirecting to /');
    return res.redirect('/');
  }

  try {
    const blogger = getBloggerService();
    const response = await blogger.blogs.listByUser({ userId: 'self' });
    const blogs = response.data.items || [];
    console.log(`[GET /blogs] Fetched ${blogs.length} blogs`);
    res.render('blogs', { blogs });
  } catch (error) {
    console.error('[GET /blogs] Error fetching blogs:', error);
    res.send('Error fetching blogs. Please try again later.');
  }
});

// List draft posts of a blog
app.get('/posts/:blogId', async (req, res) => {
  if (!setCredentialsFromSession(req)) {
    console.log('[GET /posts/:blogId] No credentials in session, redirecting to /');
    return res.redirect('/');
  }

  const blogId = req.params.blogId;

  try {
    const blogger = getBloggerService();
    const response = await blogger.posts.list({
      blogId,
      status: 'draft'
    });
    const postsRaw = response.data.items || [];

    // Add firstImage property for each post
    const posts = postsRaw.map(post => ({
      id: post.id,
      title: post.title,
      content: post.content,
      firstImage: extractFirstImage(post.content)
    }));

    console.log(`[GET /posts/${blogId}] Fetched ${posts.length} draft posts`);
    res.render('posts', { posts, blogId });
  } catch (error) {
    console.error(`[GET /posts/${blogId}] Error fetching posts:`, error);
    res.send('Error fetching posts. Please try again later.');
  }
});

// Publish post
app.get('/publish/:blogId/:postId', async (req, res) => {
  if (!setCredentialsFromSession(req)) {
    console.log('[GET /publish/:blogId/:postId] No credentials in session, redirecting to /');
    return res.redirect('/');
  }

  const { blogId, postId } = req.params;

  try {
    const blogger = getBloggerService();
    await blogger.posts.publish({
      blogId,
      postId
    });
    console.log(`[GET /publish/${blogId}/${postId}] Post published`);
    res.redirect(`/posts/${blogId}`);
  } catch (error) {
    console.error(`[GET /publish/${blogId}/${postId}] Error publishing post:`, error);
    res.send('Error publishing post. Please try again later.');
  }
});

// Delete post
app.get('/delete/:blogId/:postId', async (req, res) => {
  if (!setCredentialsFromSession(req)) {
    console.log('[GET /delete/:blogId/:postId] No credentials in session, redirecting to /');
    return res.redirect('/');
  }

  const { blogId, postId } = req.params;

  try {
    const blogger = getBloggerService();
    await blogger.posts.delete({
      blogId,
      postId
    });
    console.log(`[GET /delete/${blogId}/${postId}] Post deleted`);
    res.redirect(`/posts/${blogId}`);
  } catch (error) {
    console.error(`[GET /delete/${blogId}/${postId}] Error deleting post:`, error);
    res.send('Error deleting post. Please try again later.');
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server started on http://localhost:${PORT}`);
});
