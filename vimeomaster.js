const fs = require("fs");
const url = require("url");
const https = require("https");
const log = (...args) => console.log("→", ...args);
const list = require("./videojson.js");
const promises = [];

function loadVideo(num, cb) {
  let masterUrl = list[num].url;
  if (!masterUrl.endsWith("?base64_init=1")) {
    masterUrl += "?base64_init=1";
  }

  getJson(masterUrl, (err, json) => {
    if (err) {
      return cb(err);
    }

    const videoData = json.video
      .sort((v1, v2) => v1.avg_bitrate - v2.avg_bitrate)
      .pop();
    const audioData = json.audio
      .sort((a1, a2) => a1.avg_bitrate - a2.avg_bitrate)
      .pop();

    const videoBaseUrl = url.resolve(
      url.resolve(masterUrl, json.base_url),
      videoData.base_url
    );
    const audioBaseUrl = url.resolve(
      url.resolve(masterUrl, json.base_url),
      audioData.base_url
    );

    processFile(
      "video",
      videoBaseUrl,
      videoData.init_segment,
      videoData.segments,
      list[num].name + ".m4v",
      err => {
        if (err) {
          return cb(err);
        }

        processFile(
          "audio",
          audioBaseUrl,
          audioData.init_segment,
          audioData.segments,
          list[num].name + ".m4a",
          err => {
            if (err) {
              return cb(err);
            }

            cb(null, num + 1);
          }
        );
      }
    );
  });
}

function mergeSegments(segmentsUrl, output, filename){
  for(let i = 0; i < segmentsUrl.length; i++){
      const segmentFileName = `${filename}.part${i}`;

      if(fs.existsSync(segmentFileName) !== true){
          continue;
      }

      output.write(fs.readFileSync(segmentFileName));

      fs.unlinkSync(segmentFileName);
  }
}

function findLastSegment(segmentsUrl, filename){
  for(let i = segmentsUrl.length - 1; i >= 0; i--){
      const segmentFileName = `${filename}.part${i}`;

      if(fs.existsSync(segmentFileName) === true){
          return i;
      }
  }

  return 0;
}

function processFile(type, baseUrl, initData, segments, filename, cb) {
  const filePath = `./parts/${filename}`;
  const downloadingFlag = `./parts/.${filename}~`;
  
  if(fs.existsSync(downloadingFlag)) {
    log("⚠️", ` ${filename} - ${type} is incomplete, restarting/resuming the download`);
  } else if (fs.existsSync(filePath)) {
    log("⚠️", ` ${filename} - ${type} already exists`);
    return cb();
  } else {
    fs.writeFileSync(downloadingFlag, '');
  }

  const segmentsUrl = segments.map(seg => baseUrl + seg.url);

  const initBuffer = Buffer.from(initData, "base64");
  fs.writeFileSync(filePath, initBuffer);

  const output = fs.createWriteStream(filePath, {
    flags: "a"
  });

  const lastSegment = findLastSegment(segmentsUrl, filePath);

  if(lastSegment > 0){
      log("⚠️ Resuming download from last segment...");
  }

  combineSegments(type, lastSegment, segmentsUrl, output, filePath, downloadingFlag, err => {
    if (err) {
      log("⚠️", ` ${err}`);
    }

    mergeSegments(segmentsUrl, output, filePath);

    output.end();
    cb();
  });
}

function downloadSegment(type, i, segmentsUrl, output, filename, downloadingFlag, cb, retry = 0){
  const retryLimit = 99;

  const segmentFileName = `${filename}.part${i}`;

  const segmentOutput = fs.createWriteStream(segmentFileName, {
      flags: "w"
  });

  https
    .get(segmentsUrl[i], res => {
      res.on("data", d => segmentOutput.write(d));

      res.on("end", () =>{
        segmentOutput.end();
        combineSegments(type, i + 1, segmentsUrl, output, filename, downloadingFlag, cb)
      });
    })
    .on("error", e => {
        if(retry < retryLimit){
          log(`\n\n⚠️ Downloading segment ${i} failed: Retrying ${retry + 1}: \n\n ${e}\n\n`);
          downloadSegment(type, i, segmentsUrl, output, filename, downloadingFlag, cb, retry + 1);
        }
        else{
          cb(e);
        }
    });
}

function combineSegments(type, i, segmentsUrl, output, filename, downloadingFlag, cb) {
  if (i >= segmentsUrl.length) {
    fs.unlinkSync(downloadingFlag);
    log("🏁", ` ${filename} - ${type} done`);
    return cb();
  }

  log(
    "📦",
    type === "video" ? "📹" : "🎧",
    `Downloading ${type} segment ${i}/${segmentsUrl.length} of ${filename}`
  );

  downloadSegment(type, i, segmentsUrl, output, filename, downloadingFlag, cb);
}

function getJson(url, cb) {
  let data = "";

  https
    .get(url, res => {
      res.on("data", d => (data += d));

      res.on("end", () => cb(null, JSON.parse(data)));
    })
    .on("error", e => {
      cb(e);
    });
}

function initJs(n = 0) {
  if (!list[n] || (!list[n].name && !list[n].url)) return;

  loadVideo(n, (err, num) => {
    if (err) {
      log("⚠️", ` ${err}`);
      return;
    }

    if (list[num]) {
      initJs(num);
    }
  });
}

initJs();
