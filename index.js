const express = require('express');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const { google } = require('googleapis');
const { TwitterApi } = require('twitter-api-v2');
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

// === متغيرات البيئة ===
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

const TWITTER_APP_KEY = process.env.TWITTER_APP_KEY;
const TWITTER_APP_SECRET = process.env.TWITTER_APP_SECRET;
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET;

console.log('-------------------------------------');
console.log('✅ فحص متغيرات البيئة');
console.log('CLIENT_ID:', CLIENT_ID || '❌ مفقود');
console.log('CLIENT_SECRET:', CLIENT_SECRET || '❌ مفقود');
console.log('REDIRECT_URI:', REDIRECT_URI || '❌ مفقود');
console.log('TWITTER_APP_KEY:', TWITTER_APP_KEY || '❌ مفقود');
console.log('TWITTER_APP_SECRET:', TWITTER_APP_SECRET || '❌ مفقود');
console.log('-------------------------------------');

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
  console.error('❌ متغيرات Google ناقصة');
}
if (!TWITTER_APP_KEY || !TWITTER_APP_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) {
  console.error('❌ متغيرات Twitter ناقصة');
}

// إعداد Google
const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
const SCOPES = ['https://www.googleapis.com/auth/blogger'];

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

// إعداد Twitter
const twitterClient = new TwitterApi({
  appKey: TWITTER_APP_KEY,
  appSecret: TWITTER_APP_SECRET,
  accessToken: TWITTER_ACCESS_TOKEN,
  accessSecret: TWITTER_ACCESS_SECRET,
});

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

    // الحصول على تفاصيل المقال
    const postResponse = await blogger.posts.get({ blogId, postId });
    const post = postResponse.data;
    const title = post.title;
    const image = extractFirstImage(post.content);
    const url = post.url;

    // نشر المقال
    await blogger.posts.publish({ blogId, postId });

    // نشر التغريدة
    let tweetText = `${title}\n${url}`;
    if (image) {
      const mediaId = await twitterClient.v1.uploadMedia(image, { mimeType: 'image/jpeg' });
      await twitterClient.v2.tweet({
        text: tweetText,
        media: { media_ids: [mediaId] }
      });
    } else {
      await twitterClient.v2.tweet(tweetText);
    }

    res.redirect(`/posts/${blogId}`);
  } catch (error) {
    console.error('[Error publishing post or tweeting]', error);
    res.send('خطأ في نشر المقال أو التغريدة.');
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

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});