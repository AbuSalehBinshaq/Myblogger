const express = require('express');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const { google } = require('googleapis');
const { TwitterApi } = require('twitter-api-v2');
const path = require('path');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());

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

// Twitter client
const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_APP_KEY,
  appSecret: process.env.TWITTER_APP_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

// Google OAuth
const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

// نشر التدوينة
app.post('/publish', async (req, res) => {
  try {
    const { title, content, blogId, accessToken } = req.body;

    oauth2Client.setCredentials({ access_token: accessToken });
    const blogger = google.blogger({ version: 'v3', auth: oauth2Client });

    const response = await blogger.posts.insert({
      blogId: blogId,
      requestBody: { title, content }
    });

    const postUrl = response.data.url;

    await twitterClient.v2.tweet(`${title}\n${postUrl}`);

    res.json({ success: true, message: 'تم النشر في بلوجر وتويتر.' });
  } catch (error) {
    console.error('خطأ في النشر:', error);
    res.status(500).json({ success: false, message: 'فشل في النشر', error: error.message });
  }
});

// حذف التدوينة
app.post('/delete', async (req, res) => {
  try {
    const { postId, blogId, accessToken } = req.body;

    oauth2Client.setCredentials({ access_token: accessToken });
    const blogger = google.blogger({ version: 'v3', auth: oauth2Client });

    await blogger.posts.delete({ blogId, postId });

    res.json({ success: true, message: 'تم الحذف من بلوجر.' });
  } catch (error) {
    console.error('خطأ في الحذف:', error);
    res.status(500).json({ success: false, message: 'فشل في الحذف', error: error.message });
  }
});

// بدء السيرفر
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});