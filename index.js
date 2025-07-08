const express = require('express');
const session = require('express-session');
const { google } = require('googleapis');
const dotenv = require('dotenv');
const path = require('path');
const { TwitterApi } = require('twitter-api-v2');

dotenv.config();

const app = express();
const PORT = 3000;

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_CALLBACK_URL
);

const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

// 🏠 الصفحة الرئيسية
app.get('/', (req, res) => {
  if (!req.session.tokens) {
    return res.render('index');
  }
  res.redirect('/blogs');
});

// 🔐 تسجيل الدخول
app.get('/auth/google', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/blogger'],
  });
  res.redirect(authUrl);
});

// 🔄 استقبال التوكن
app.get('/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    req.session.tokens = tokens;
    res.redirect('/blogs');
  } catch (err) {
    console.error('Auth Error:', err);
    res.send('فشل تسجيل الدخول');
  }
});

// 📚 عرض المدونات
app.get('/blogs', async (req, res) => {
  if (!req.session.tokens) return res.redirect('/');
  oauth2Client.setCredentials(req.session.tokens);

  const blogger = google.blogger({ version: 'v3', auth: oauth2Client });

  try {
    const result = await blogger.blogs.listByUser({ userId: 'self' });
    res.render('blogs', { blogs: result.data.items || [] });
  } catch (err) {
    console.error('Blogs Error:', err);
    res.send('حدث خطأ أثناء تحميل المدونات');
  }
});

// 📝 عرض المسودات
app.get('/blogs/:blogId/drafts', async (req, res) => {
  if (!req.session.tokens) return res.redirect('/');

  const blogId = req.params.blogId;
  const message = req.query.message;
  oauth2Client.setCredentials(req.session.tokens);
  const blogger = google.blogger({ version: 'v3', auth: oauth2Client });

  try {
    const blog = await blogger.blogs.get({ blogId });
    const result = await blogger.posts.list({
      blogId,
      status: 'draft',
      fetchBodies: true,
      maxResults: 20
    });

    const drafts = (result.data.items || []).map(post => {
      const imgMatch = post.content?.match(/<img[^>]+src="([^">]+)"/);
      return {
        id: post.id,
        title: post.title,
        contentSnippet: post.content?.replace(/<[^>]*>/g, '').slice(0, 100),
        image: imgMatch ? imgMatch[1] : null,
      };
    });

    res.render('drafts', {
      blogId,
      blogName: blog.data.name,
      drafts,
      message
    });

  } catch (err) {
    console.error('Drafts Error:', err);
    res.send('حدث خطأ أثناء تحميل المسودات');
  }
});

// 🚀 نشر التدوينة
app.post('/publish/:blogId/:postId', async (req, res) => {
  if (!req.session.tokens) return res.redirect('/');

  const { blogId, postId } = req.params;
  const tweet = req.query.tweet === 'true';
  oauth2Client.setCredentials(req.session.tokens);
  const blogger = google.blogger({ version: 'v3', auth: oauth2Client });

  console.log(`🔄 Publishing post...`);
  console.log(`Blog ID: ${blogId}`);
  console.log(`Post ID: ${postId}`);
  console.log(`Tweet enabled: ${tweet}`);

  try {
    await blogger.posts.publish({ blogId, postId });
    console.log('✅ Post published on Blogger.');

    const postResult = await blogger.posts.get({ blogId, postId });
    const post = postResult.data;

    if (tweet) {
      const tweetText = `${post.title}\n${post.url}`;
      console.log('🕊 Tweet content would be:');
      console.log(tweetText);
      // التغريد معطّل مؤقتًا
      // await twitterClient.v2.tweet(tweetText);
    }

    res.redirect(`/blogs/${blogId}/drafts?message=تم+نشر+التدوينة+بنجاح`);
  } catch (err) {
    console.error('❌ Publish Error:', err);
    res.redirect(`/blogs/${blogId}/drafts?message=حدث+خطأ+أثناء+النشر`);
  }
});

// 🗑 حذف تدوينة
app.post('/delete/:blogId/:postId', async (req, res) => {
  if (!req.session.tokens) return res.redirect('/');

  const { blogId, postId } = req.params;
  oauth2Client.setCredentials(req.session.tokens);
  const blogger = google.blogger({ version: 'v3', auth: oauth2Client });

  try {
    await blogger.posts.delete({ blogId, postId });
    res.redirect(`/blogs/${blogId}/drafts?message=تم+حذف+المسودة`);
  } catch (err) {
    console.error('Delete Error:', err);
    res.redirect(`/blogs/${blogId}/drafts?message=فشل+حذف+المسودة`);
  }
});

// 🔓 تسجيل الخروج
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// 🚀 تشغيل السيرفر
app.listen(PORT, () => {
  console.log(`🚀 السيرفر يعمل على http://localhost:${PORT}`);
});