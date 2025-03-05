const fs = require('fs');
const csv = require('csv-parser');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const JSPJs = require('jsp-js').Renderer;


const report = new function () {
    const csvFilePath = process.argv[2]; // Get the CSV file path from the first command line argument
    const splitPath = csvFilePath.split('/');
    const videoFileName = splitPath[splitPath.length - 2];
    const reportDir = './report';
    const videoDir = '../../tmp/video-tests';
    const templateDir = './templates/report';

    const jsp = new JSPJs({
        root: [
            path.join(__dirname, 'templates/report')
        ],
        tags: {
            foo: {
                bar() {
                    return '<h2>Baz</h2>';
                }
            }
        },
        globals: {
            videoFileName: videoFileName,
            dateGenerated: new Date(Date.now())
        }
    });

    const luminanceViolations = [],
    redViolations = [];

    let isInLuminanceViolation = false,
        isInRedViolation = false,
        luminanceStart = 0
        redStart = 0,
        violations = {};

    this.generate = () => {
        try {
            cleanDirectory(reportDir);
        } catch (error) {
            console.error(`Couldn't clean directory ${reportDir}`);
        }

        findFlashAreas()
            .then(({ luminanceViolations, redViolations }) => {
                console.log('Luminance Violations:', luminanceViolations);
                console.log('Red Violations:', redViolations);

                generateReportImages(luminanceViolations, redViolations);

                violations = {luminanceViolations, redViolations};

                // Now render the HTML report.
                renderHTML();
            })
            .catch(console.error);

    }

    const renderHTML = () => {
        const html = jsp.render(`${templateDir}/index.jsp`, {
            luminanceViolations,
            redViolations
        });

        console.log(`html: ${html}`);

        fs.writeFile(`${reportDir}/index.html`, html, 'utf8', (err) => {
            if (err) {
                console.error(`Report can not be save to disk  Please ensure you are able to write to directory ${reportDir}`, err);
            } else {
                console.log('Report written successfully');
            }
        });
        
    }

    const createDirIfNotThere =  (dirPath) => {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
            console.log(`Directory created: ${dirPath}`);
            return;
        }
    }

    /**
    * Removes all files and subdirectories from a given directory.
    * @param {string} dirPath - The path to the directory to clean.
    */
    const cleanDirectory = (dirPath) => {
        try {
            createDirIfNotThere(dirPath)
    
            fs.readdirSync(dirPath).forEach((file) => {
                const fullPath = path.join(dirPath, file);
                if (fs.lstatSync(fullPath).isDirectory()) {
                    cleanDirectory(fullPath);
                    fs.rmdirSync(fullPath);
                } else {
                    fs.unlinkSync(fullPath);
                }
            });
    
            console.log(`Directory cleaned: ${dirPath}`);
        } catch (error) {
            console.error(`Failed to create or clean directory: ${dirPath}`, error);
            throw error;
        }
    }

    const generateReportImages = (luminanceViolations, redViolations) => {
        const luminanceDir = `luminanceFrames`,
            redDir = `redFrames`;

        createDirIfNotThere(`${reportDir}/${luminanceDir}`);
        createDirIfNotThere(`${reportDir}/${redDir}`);

        for (let i = 0; i<luminanceViolations.length; i++) {
            const time = luminanceViolations[i].start;
            const outputFile = `${luminanceDir}/file-frame_at_${time.replace(/:/g, '-')}.png`;

            luminanceViolations[i].imgURL = outputFile;

            (async () => {
                try {
                    await captureFrame(videoFileName, time, luminanceDir, outputFile);
                    
                } catch (ex) {
                    console.error('Error capturing frame:', ex);
                }
            })();
            
        }

        for (let i = 0; i<redViolations.length; i++) {
            const time = redViolations[i].start;
            const outputFile = `${redDir}/file-frame_at_${time.replace(/:/g, '-')}.png`;

            redViolations[i].imgURL = outputFile;
            
            (async () => {
                try {
                    await captureFrame(videoFileName, redViolations[i].start, redDir, outputFile);
                    
                } catch (ex) {
                    console.error('Error capturing frame:', ex);
                }
            })();
            
        }
    }

    /**
     * Capture a still image from a video at a specific timestamp.
     * @param {string} file - The path to the video file.
     * @param {string} time - The timestamp in the format 'HH:MM:SS' or in seconds.
     * @param {string} [outputDir='./'] - Optional output directory for the image.
     * @returns {Promise<string>} - The path to the captured image.
     */
    const captureFrame = (file, time, outputDir, outputFile) => {
        const videoPath = `${videoDir}/${videoFileName}`;
        return new Promise((resolve, reject) => {
            //const outputFile = `${outputDir}/file-frame_at_${time.replace(/:/g, '-')}.png`;
            console.log(`Creating: ${outputFile}`);
            const fullFilePath=`${reportDir}/${outputDir}/${outputFile}`;
            ffmpeg(videoPath)
                .screenshots({
                    timestamps: [time],
                    filename: path.basename(fullFilePath),
                    folder: `${reportDir}/${outputDir}`,
                    size: '1920x1080'
                })
                .on('end', () => {
                    console.log('Image captured:', fullFilePath);
                    resolve(fullFilePath);
                })
                .on('error', (err) => {
                    console.error('Error capturing image:', err);
                    reject(err);
                });
        });
    }
    
    const logLuminanceViolation = function (TimeStamp) {
        luminanceViolations.push({
            'start': luminanceStart,
            'end': TimeStamp,
            'index': luminanceViolations.length + 1
        });

        // clear the information 
        isInLuminanceViolation = false;
        luminanceStart = null;
    }
    
    const logRedViolation = function (TimeStamp) {
        redViolations.push({
            'start': redStart,
            'end': TimeStamp,
            'index': redViolations.length + 1
        });

        // clear the information 
        isInRedViolation = false;
        redStart = null;
    }



    const findFlashAreas = () => {
        return new Promise((resolve, reject) => {
            let lastRow;

            if (!csvFilePath) {
                console.error('Please provide the path to the CSV file as a command line argument.');
                process.exit(1);
            }
            
            fs.createReadStream(csvFilePath)
                .pipe(csv())
                .on('data', (row) => {
                    const col13 = parseFloat(row[Object.keys(row)[12]]);
                    const col14 = parseFloat(row[Object.keys(row)[13]]);
                    const { TimeStamp } = row;
                    if (col13 >= 3 && !isInLuminanceViolation) {
                        isInLuminanceViolation = true;
                        luminanceStart = TimeStamp;
                    } else if (col13 < 3 && isInLuminanceViolation) {
                        logLuminanceViolation(TimeStamp);
                    }
                        
                        
                    if (col14 >= 3 && !isInRedViolation) {
                        isInRedViolation = true;
                        redStart = TimeStamp;
                    } else if (col14 < 3 && isInRedViolation) {
                        logRedViolation(TimeStamp);
                        
                    }

                    lastRow = row;
                
                }).on('end', () => {
                    const { TimeStamp } = lastRow;
                    if (isInLuminanceViolation) {
                        logLuminanceViolation(TimeStamp);
                    }

                    if (isInRedViolation) {
                        logRedViolation(TimeStamp);
                    }

                    console.log('CSV file successfully processed');
                    resolve({
                        luminanceViolations,
                        redViolations
                    });
                }).on('error', (err) => {
                    reject(err);
                });;
        });        
    }
}

report.generate()

