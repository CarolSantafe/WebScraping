const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const { PDFDocument, rgb } = require('pdf-lib');

const app = express();
const PORT = 3000;
const TARGET_URL = 'https://prosperidadsocial.gov.co/noticias/';

async function scrapeProsperidadSocial() {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({ headless: true });
    console.log('Browser launched');
    
    const page = await browser.newPage();
    console.log('New page created');

    let newsTitles = [];
    let nextPage = TARGET_URL;

    console.log(`Navigating to ${nextPage}`);
    await page.goto(nextPage, { waitUntil: 'networkidle2' });
    console.log(`Navigation to ${nextPage} completed`);

    // Extraer los títulos de las noticias en la página actual
    const titlesOnPage = await page.evaluate(() => {
        let titleElements = document.querySelectorAll('a[rel="bookmark"]');
        let titles = [];
        titleElements.forEach(titleElement => {
            titles.push(titleElement.innerText.trim());
        });
        return titles;
    });

    console.log(`Found ${titlesOnPage.length} titles on page`);
    newsTitles = newsTitles.concat(titlesOnPage);

    // Verificar si hay un botón de "Siguiente" y obtener su URL
    nextPage = await page.evaluate(() => {
        let nextButton = document.querySelector('a.next.page-numbers');
        return nextButton ? nextButton.href : null;
    });
    console.log(`Next page: ${nextPage}`);

    console.log('Closing browser...');
    await browser.close();
    console.log('Browser closed');

    return newsTitles;
}

async function createPdf(titles) {
    console.log('Creating PDF...');
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 800]);
    const { width, height } = page.getSize();
    const fontSize = 12;

    let y = height - fontSize;

    titles.forEach((title, index) => {
        if (y < fontSize * 2) {
            page.addPage();
            y = height - fontSize;
        }
        page.drawText(`${index + 1}. ${title}`, {
            x: 50,
            y,
            size: fontSize,
            color: rgb(0, 0, 0),
        });
        y -= fontSize * 2;
    });

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync('news_titles.pdf', pdfBytes);
    console.log('PDF created successfully!');
}

app.get('/scraping', async (req, res) => {
    try {
        console.log('Scraping started...');
        const titles = await scrapeProsperidadSocial();
        console.log(`Scraping completed. Found ${titles.length} titles.`);
        await createPdf(titles);
        res.send('PDF created successfully!');
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('Error fetching the URL');
    }
});

app.listen(PORT, () => {
    console.log(`RUNNING ON PORT ${PORT}`);
});
