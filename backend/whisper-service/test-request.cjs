const fs = require('fs');
const http = require('http');

const filePath = process.argv[2] || 'silent.wav';
const stats = fs.statSync(filePath);
const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';

const options = {
  hostname: 'localhost',
  port: 3005,
  path: '/transcribe',
  method: 'POST',
  headers: {
    'Content-Type': 'multipart/form-data; boundary=' + boundary,
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Response:', data);
  });
});

req.on('error', (e) => {
  console.error('Problem with request:', e.message);
});

req.write('--' + boundary + '\r\n');
req.write('Content-Disposition: form-data; name="file"; filename="' + filePath + '"\r\n');
req.write('Content-Type: audio/wav\r\n\r\n');

const fileStream = fs.createReadStream(filePath);
fileStream.on('data', (chunk) => {
  req.write(chunk);
});

fileStream.on('end', () => {
  req.write('\r\n--' + boundary + '--\r\n');
  req.end();
});
