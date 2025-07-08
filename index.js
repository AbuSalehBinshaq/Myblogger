require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const { google } = require('googleapis');
const { TwitterApi } = require('twitter-api-v2');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
  store: new MemoryStore({ checkPeriod: 86400000 }),
  secret: 'supersecretkey',
  resave: false,
  saveUninitialized: true
}));

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

const TWITTER_APP_KEY = process.env.TWITTER_API_KEY;
const TWITTER_APP_SECRET = process.env.TWITTER_API_SECRET;
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET;

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
  const match = html.match(/<img[^>]+src="([^">]+)"/i);
  return match ? match[1] : null;
}

const twitterClient = new TwitterApi({
  appKey: TWITTER_APP_KEY,
  appSecret: TWITTER_APP_SECRET,
  accessToken: TWITTER_ACCESS_TOKEN,
  accessSecret: TWITTER_ACCESS_SECRET,
});

// === Routes ===

app.get('/', (req, res) => {
  if (!req.session.credentials) return res.render('login');
  res.redirect('/blogs');
});

app.get('/login', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
  res.redirect(url);
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect('/');
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    req.session.credentials = tokens;
    res.redirect('/blogs');
  } catch (err) {
    console.error('[OAuth Error]', err);
    res.send('فشل تسجيل الدخول.');
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
    res.render('blogs', { blogs: response.data.items || [] });
  } catch (err) {
    console.error('[Error fetching blogs]', err);
    res.send('تعذر جلب المدونات.');
  }
});

app.get('/posts/:blogId', async (req, res) => {
  if (!setCredentialsFromSession(req)) return res.redirect('/');
  const blogId = req.params.blogId;
  try {
    const blogger = getBloggerService();
    const response = await blogger.posts.list({
      blogId,
      status: 'draft',
      fetchBodies: true,
      maxResults: 50
    });

    const posts = (response.data.items || []).map(post => ({
      id: post.id,
      title: post.title,
      content: post.content,
      firstImage: extractFirstImage(post.content)
    }));

    res.render('posts', { posts, blogId });
  } catch (err) {
    console.error('[Error fetching posts]', err);
    res.send('تعذر جلب التدوينات.');
  }
});

app.get('/publish/:blogId/:postId', async (req, res) => {
  if (!setCredentialsFromSession(req)) return res.redirect('/');
  const { blogId, postId } = req.params;

  try {
    const blogger = getBloggerService();
    console.log(`📥 جلب المسودة: blogId=${blogId}, postId=${postId}`);

    const getRes = await blogger.posts.get({ blogId, postId });
    const post = getRes.data;

    console.log(`✅ تم جلب المسودة: ${post.title}`);

    const updateRes = await blogger.posts.update({
      blogId,
      postId,
      requestBody: {
        ...post,
        status: "live"
      }
    });

    const published = updateRes.data;
    console.log('✅ تم تحويل المسودة إلى منشور:', published.url);

    const title = published.title || "بدون عنوان";
    const url = published.url;
    const image = extractFirstImage(published.content);
    const tweetText = `${title}\n${url}`;

    try {
      console.log('✍️ نشر التغريدة...');
      if (image) {
        const mediaId = await twitterClient.v1.uploadMedia(image, { mimeType: 'image/jpeg' });
        await twitterClient.v2.tweet({ text: tweetText, media: { media_ids: [mediaId] } });
        console.log('✅ تم نشر التغريدة مع صورة');
      } else {
        await twitterClient.v2.tweet(tweetText);
        console.log('✅ تم نشر التغريدة بدون صورة');
      }
    } catch (err) {
      const isDuplicate = err?.data?.detail?.includes('duplicate');
      if (isDuplicate) {
        console.warn('⚠️ التغريدة مكررة. لم تُرسل.');
      } else {
        console.error('❌ فشل في نشر التغريدة:', err.response?.data || err.message);
      }
    }

    res.redirect(`/posts/${blogId}`);
  } catch (err) {
    console.error('[Publish Error]', err);
    res.redirect(`/posts/${blogId}?error=1`);
  }
});

app.get('/delete/:blogId/:postId', async (req, res) => {
  if (!setCredentialsFromSession(req)) return res.redirect('/');
  const { blogId, postId } = req.params;

  try {
    const blogger = getBloggerService();
    await blogger.posts.delete({ blogId, postId });
    res.redirect(`/posts/${blogId}`);
  } catch (err) {
    console.error('[Delete Error]', err);
    res.send('تعذر حذف المقال.');
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});