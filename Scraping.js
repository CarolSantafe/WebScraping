const express = require("express");
const app = express();
const puppeteer = require("puppeteer");
const fs = require("fs");
const http = require("http").Server(app);
const io = require("socket.io")(http);
const moment = require("moment");
const nodemailer = require("nodemailer");
const { PDFDocument, rgb } = require("pdf-lib");
require("dotenv").config({ path: ".env" });

const TARGET_URL = "https://prosperidadsocial.gov.co/noticias/";

const PORT = process.env.PORT;
const IP_ADDRESS = process.env.IP_ADDRESS;
const timestamp = moment().format("YYYY-MM-DD HH:mm:ss");

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

async function scrapeProsperidadSocial(keyword) {
  const logMessage = `${timestamp} Launching browser...`;
  console.log(logMessage);
  io.emit("newLog", logMessage);
  const browser = await puppeteer.launch({ headless: true });
  const logMessage2 = `${timestamp} Browser launched`;
  console.log(logMessage2);
  io.emit("newLog", logMessage2);

  const page = await browser.newPage();
  const logMessage3 = `${timestamp} New page created`;
  console.log(logMessage3);
  io.emit("newLog", logMessage3);

  let newsTitles = [];
  let nextPage = TARGET_URL;

  while (nextPage) {
    const logMessage4 = `${timestamp} Navigating to ${nextPage}`;
    console.log(logMessage4);
    io.emit("newLog", logMessage4);

    await page.goto(nextPage, { waitUntil: "networkidle2" });

    const logMessage5 = `${timestamp} Navigation to ${nextPage} completed`;
    console.log(logMessage5);
    io.emit("newLog", logMessage5);

    // Extraer los títulos de las noticias en la página actual
    const titlesOnPage = await page.evaluate(() => {
      let titleElements = document.querySelectorAll('a[rel="bookmark"]');
      let titles = [];
      titleElements.forEach((titleElement) => {
        titles.push(titleElement.innerText.trim());
      });
      return titles;
    });

    const logMessage6 = `${timestamp} Found ${titlesOnPage.length} titles on page`;
    console.log(logMessage6);
    io.emit("newLog", logMessage6);

    // Filtrar los títulos que contienen la palabra clave
    const filteredTitles = titlesOnPage.filter((title) =>
      title.toLowerCase().includes(keyword.toLowerCase())
    );
    newsTitles = newsTitles.concat(filteredTitles);

    // Verificar si hay un botón de "Siguiente" y obtener su URL
    nextPage = await page.evaluate(() => {
      let nextButton = document.querySelector("a.next.page-numbers");
      return nextButton ? nextButton.href : null;
    });

    const logMessage7 = `${timestamp} Next page: ${nextPage}`;
    console.log(logMessage7);
    io.emit("newLog", logMessage7);
  }

  const logMessage8 = `${timestamp} Closing browser...`;
  console.log(logMessage8);
  io.emit("newLog", logMessage8);
  await browser.close();

  const logMessage9 = `${timestamp} Browser closed`;
  console.log(logMessage9);
  io.emit("newLog", logMessage9);

  return newsTitles;
}

async function createPdf(titles, email) {
  const logMessage = `${timestamp} Creating PDF...`;
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
  const logMessage2 = `${timestamp} PDF created successfully!`;
  console.log(logMessage2);
  io.emit("newLog", logMessage2);

  await sendEmailWithPDF(email, pdfPath);
}

async function sendEmailWithPDF(email, pdfPath) {
  try {
    // Configurar el transporte de correo electrónico (en este ejemplo, usaremos un servicio de Gmail)
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "proyectovissim@gmail.com", // Tu correo electrónico de Gmail
        pass: "vissim0321", // Tu contraseña de Gmail
      },
    });

    // Configurar el correo electrónico
    const mailOptions = {
      from: "proyectovissim@gmail.com", // Remitente
      to: email, // Destinatario
      subject: "Títulos de noticias de Prosperidad Social", // Asunto
      text: "Adjunto encontrarás un PDF con los títulos de noticias solicitados.", // Cuerpo del correo
      attachments: [
        {
          filename: "news_titles.pdf", // Nombre del archivo adjunto
          path: pdfPath, // Ruta del archivo PDF
        },
      ],
    };

    // Enviar el correo electrónico
    const info = await transporter.sendMail(mailOptions);
    const logMessage3 = `${timestamp} Navigating to ${nextPage} ` + info.messageId;
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
    const logMessage = `${timestamp} Scraping started for keyword: ${keyword}...`;
    console.log(logMessage);
    io.emit("newLog", logMessage);

    const titles = await scrapeProsperidadSocial(keyword);
    const logMessage2 = `${timestamp} Scraping completed. Found ${titles.length} titles.`;
    console.log(logMessage2);
    io.emit("newLog", logMessage2);

    await createPdf(titles, email);
    res.send("PDF created successfully!");
  } catch (error) {
    console.error("Error:", error);
    res.status(500).send("Error fetching the URL");
  }
});

io.on("connection", (socket) => {
  console.log(`${timestamp} A user connected`);

  socket.on("disconnect", () => {
    console.log(`${timestamp} User disconnected`);
  });
});

http.listen(PORT, IP_ADDRESS, () => {
  console.log(`Servidor escuchando en http://${IP_ADDRESS}:${PORT}`);
});
