const express = require('express');
const app = express();
app.use(express.json());

const githubWebhook = require('./github-apis');

app.use('/github', githubWebhook);

app.get('/', (req, res) => {
    res.send('Hello World');
});

app.listen(3001, () => { 
    console.log('Server is running on port 3001');
});