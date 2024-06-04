const express = require("express");
const cors = require("cors");
const app = express();
const puppeteer = require("puppeteer");
const fs = require("fs");
const http = require("http").Server(app);
const io = require("socket.io")(http);
const nodemailer = require("nodemailer");
const redis = require("redis");
const axios = require("axios");
const responseTime = require("response-time");
const moment = require("moment");
const { promisify } = require("util");
const { PDFDocument, rgb } = require("pdf-lib");
require("dotenv").config({ path: ".env" });

const client = redis.createClient({
  host: "localhost",
  port: 6379,
});

client.connect();

client.on("connect", () => {
  console.log("Connected to Redis...");
});

client.on("error", (err) => {
  console.error("Error connecting to Redis:", err);
});

const GET_ASYNC = promisify(client.get).bind(client);
const SET_ASYNC = promisify(client.set).bind(client);

const TARGET_URL = "https://prosperidadsocial.gov.co/noticias/";

const PORT = process.env.PORT;
const IP_ADDRESS = process.env.IP_ADDRESS;
const SERVER_NAME = process.env.SERVER_NAME;
const HOST_PORT = process.env.HOST_PORT;
const HOST_IP = process.env.HOST_IP;
const SERVER_ID = process.env.SERVER_ID;
const BALANCER_IP = process.env.BALANCER_IP;
const BALANCER_PORT = process.env.BALANCER_PORT;

const queue = [];
let isProcessingQueue = false;

app.use(cors());
app.use(responseTime());

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.get("/popular-queries", async (req, res) => {
  client
    .set("clave", "valor2")
    .then((reply) => {const logMessage = `${moment().format(
      "YYYY-MM-DD HH:mm:ss"
    )} Valor obtenido de Redis: ${reply}`;
    console.log(logMessage);
    io.emit("newLog", logMessage);} )
    .catch((err) =>
      console.error("Error al establecer el valor en Redis:", err)
    );

  client
    .get("clave")
    .then((reply) => {
      const logMessage = `${moment().format(
        "YYYY-MM-DD HH:mm:ss"
      )} Valor obtenido de Redis: ${reply}`;
      console.log(logMessage);
      io.emit("newLog", logMessage);
    })
    .catch((err) => console.error("Error al obtener el valor de Redis:", err));
});

async function scrapeProsperidadSocial(keyword) {
  const logMessage = `${moment().format(
    "YYYY-MM-DD HH:mm:ss"
  )} Launching browser...`;
  console.log(logMessage);
  io.emit("newLog", logMessage);
  const browser = await puppeteer.launch({ headless: true });
  const logMessage2 = `${moment().format(
    "YYYY-MM-DD HH:mm:ss"
  )} Browser launched`;
  console.log(logMessage2);
  io.emit("newLog", logMessage2);

  const page = await browser.newPage();
  const logMessage3 = `${moment().format(
    "YYYY-MM-DD HH:mm:ss"
  )} New page created`;
  console.log(logMessage3);
  io.emit("newLog", logMessage3);

  let newsTitles = [];
  let nextPage = TARGET_URL;

  while (nextPage) {
    const logMessage4 = `${moment().format(
      "YYYY-MM-DD HH:mm:ss"
    )} Navigating to ${nextPage}`;
    console.log(logMessage4);
    io.emit("newLog", logMessage4);

    await page.goto(nextPage, { waitUntil: "networkidle2" });

    const logMessage5 = `${moment().format(
      "YYYY-MM-DD HH:mm:ss"
    )} Navigation to ${nextPage} completed`;
    console.log(logMessage5);
    io.emit("newLog", logMessage5);

    const titlesOnPage = await page.evaluate(() => {
      let titleElements = document.querySelectorAll('a[rel="bookmark"]');
      let titles = [];
      titleElements.forEach((titleElement) => {
        titles.push(titleElement.innerText.trim());
      });
      return titles;
    });

    const logMessage6 = `${moment().format("YYYY-MM-DD HH:mm:ss")} Found ${
      titlesOnPage.length
    } titles on page`;
    console.log(logMessage6);
    io.emit("newLog", logMessage6);

    const filteredTitles = titlesOnPage.filter((title) =>
      title.toLowerCase().includes(keyword.toLowerCase())
    );
    newsTitles = newsTitles.concat(filteredTitles);

    nextPage = await page.evaluate(() => {
      let nextButton = document.querySelector("a.next.page-numbers");
      return nextButton ? nextButton.href : null;
    });

    const logMessage7 = `${moment().format(
      "YYYY-MM-DD HH:mm:ss"
    )} Next page: ${nextPage}`;
    console.log(logMessage7);
    io.emit("newLog", logMessage7);
  }

  const logMessage8 = `${moment().format(
    "YYYY-MM-DD HH:mm:ss"
  )} Closing browser...`;
  console.log(logMessage8);
  io.emit("newLog", logMessage8);
  await browser.close();

  const logMessage9 = `${moment().format(
    "YYYY-MM-DD HH:mm:ss"
  )} Browser closed`;
  console.log(logMessage9);
  io.emit("newLog", logMessage9);

  return newsTitles;
}

async function createPdf(titles, email) {
  const logMessage = `${moment().format(
    "YYYY-MM-DD HH:mm:ss"
  )} Creating PDF...`;
  console.log(logMessage);
  io.emit("newLog", logMessage);

  const pdfDoc = await PDFDocument.create();
  const fontSize = 12;
  let currentPage = pdfDoc.addPage([600, 800]);
  let y = currentPage.getSize().height - fontSize;

  for (let i = 0; i < titles.length; i++) {
    const title = `${i + 1}. ${titles[i].replace(/\u200B/g, "")}`;

    if (y < fontSize * 2) {
      currentPage = pdfDoc.addPage([600, 800]);
      y = currentPage.getSize().height - fontSize;
    }

    currentPage.drawText(title, {
      x: 50,
      y,
      size: fontSize,
      color: rgb(0, 0, 0),
    });
    y -= fontSize * 2;
  }

  const pdfBytes = await pdfDoc.save();
  const pdfPath = "news_titles.pdf";
  fs.writeFileSync(pdfPath, pdfBytes);
  const logMessage2 = `${moment().format(
    "YYYY-MM-DD HH:mm:ss"
  )} PDF created successfully!`;
  console.log(logMessage2);
  io.emit("newLog", logMessage2);

  await sendEmailWithPDF(email, pdfPath);
}

async function sendEmailWithPDF(email, pdfPath) {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "proyectovissim@gmail.com",
        pass: "vissim0321",
      },
    });

    const mailOptions = {
      from: "proyectovissim@gmail.com",
      to: email,
      subject: "Títulos de noticias de Prosperidad Social",
      text: "Adjunto encontrarás un PDF con los títulos de noticias solicitados.",
      attachments: [
        {
          filename: "news_titles.pdf",
          path: pdfPath,
        },
      ],
    };

    const info = await transporter.sendMail(mailOptions);
    const logMessage3 = `${moment().format(
      "YYYY-MM-DD HH:mm:ss"
    )} Email sent: ${info.messageId}`;
    console.log(logMessage3);
    io.emit("newLog", logMessage3);
  } catch (error) {
    console.error("Error al enviar el correo electrónico:", error);
  }
}

app.get("/scraping", async (req, res) => {
  try {
    const keyword = req.query.keyword;
    const email = req.query.email;

    if (!keyword) {
      res.status(400).send("Keyword is required");
      return;
    }

    const logMessage = `${moment().format(
      "YYYY-MM-DD HH:mm:ss"
    )} Scraping request received for keyword: ${keyword}`;
    console.log(logMessage);
    io.emit("newLog", logMessage);

    const job = { keyword, email };
    queue.push(job);

    const logMessage2 = `${moment().format(
      "YYYY-MM-DD HH:mm:ss"
    )} Job enqueued. Queue length: ${queue.length}`;
    console.log(logMessage2);
    io.emit("newLog", logMessage2);

    if (!isProcessingQueue && queue.length === 1) {
      processQueue();
    }

    res.send("Job enqueued successfully!");
  } catch (error) {
    console.error("Error:", error);
    res.status(500).send("Error processing the request");
  }
});

function processQueue() {
  if (isProcessingQueue || queue.length === 0) {
    const logMessage = `${moment().format(
      "YYYY-MM-DD HH:mm:ss"
    )} Queue is empty or already being processed`;
    console.log(logMessage);
    io.emit("newLog", logMessage);
    return;
  }

  isProcessingQueue = true; // Marca que la cola está siendo procesada

  const job = queue.shift();
  const { keyword, email } = job;
  const startTime = new Date().getTime();

  const logMessage = `${moment().format(
    "YYYY-MM-DD HH:mm:ss"
  )} Processing job for keyword: ${keyword}`;
  console.log(logMessage);
  io.emit("newLog", logMessage);

  scrapeProsperidadSocial(keyword)
    .then((titles) => {
      const logMessage2 = `${moment().format(
        "YYYY-MM-DD HH:mm:ss"
      )} Scraping completed. Found ${titles.length} titles.`;
      console.log(logMessage2);
      io.emit("newLog", logMessage2);

      return createPdf(titles, email);
    })
    .then(() => {
      const endTime = new Date().getTime();
      const duration = endTime - startTime;
      const logMessage3 = `${moment().format(
        "YYYY-MM-DD HH:mm:ss"
      )} PDF created and email sent successfully! Job completed in ${duration} ms`;
      console.log(logMessage3);
      io.emit("newLog", logMessage3);

      isProcessingQueue = false; // Marca que la cola ha terminado de procesarse
      processQueue(); // Procesar el siguiente trabajo de la cola
    })
    .catch((error) => {
      console.error("Error:", error);
      isProcessingQueue = false; // Marca que la cola ha terminado de procesarse
      processQueue(); // Procesar el siguiente trabajo de la cola
    });
}

processQueue();

app.get("/queue-length", (req, res) => {
  const queueLength = queue.length;
  const logMessage = `${moment().format(
    "YYYY-MM-DD HH:mm:ss"
  )} Queue length: ${queueLength}`;
  console.log(logMessage);
  io.emit("newLog", logMessage);
  res.send(`Queue length: ${queueLength}`);
});

io.on("connection", (socket) => {
  const logMessage = `${moment().format(
    "YYYY-MM-DD HH:mm:ss"
  )} A user connected`;
  console.log(logMessage);
  io.emit("newLog", logMessage);

  socket.on("disconnect", () => {
    const logMessage2 = `${moment().format(
      "YYYY-MM-DD HH:mm:ss"
    )} User disconnected`;
    console.log(logMessage2);
    io.emit("newLog", logMessage2);
  });
});

http.listen(PORT, IP_ADDRESS, () => {
  console.log(`Servidor escuchando en http://${IP_ADDRESS}:${PORT}`);
});
