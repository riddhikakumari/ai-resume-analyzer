import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router';
import FileUploader from '~/components/FileUploader';
import Navbar from "~/components/Navbar"
import { convertPdfToImage } from '~/lib/pdf2img';
import { usePuterStore } from '~/lib/puter';
import { generateUUID, formatSize } from '~/lib/utils';
import { prepareInstructions } from './constants';
const Upload = () => { 
    const { auth, isLoading, fs, ai,kv } = usePuterStore();
    const navigate = useNavigate();
    // Start with not-processing so the upload form is visible by default
    const [isProcessing, setIsProcessing] = useState(false);
    const [statusText, setStatusText] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const handleFileSelect = (file: File | null) => {
        setFile(file)
        // Debug: log selection in parent to verify updates
        console.debug('[Upload] handleFileSelect:', file ? { name: file.name, size: file.size } : null);
    }

    const handleAnalyze = async ({ companyName, jobTitle, jobDescription, file }: { companyName: string, jobTitle: string, jobDescription: string, file: File }) => {
         setIsProcessing(true);
         setStatusText('Uploading the file...');
         const uploadedFile: any = await fs.upload([file]);

         if(!uploadedFile) return setStatusText('Error: Failed to upload file');

        setStatusText('Converting to image...');
        let imageFile;
        try {
            console.debug('[Upload] convertPdfToImage starting for file:', file.name);
            imageFile = await convertPdfToImage(file);
            console.debug('[Upload] convertPdfToImage result:', imageFile);
        } catch (err) {
            console.error('[Upload] convertPdfToImage threw', err);
            return setStatusText('Error: Failed to convert PDF to image: ' + (err instanceof Error ? err.message : String(err)));
        }

        if (!imageFile || !imageFile.file) {
            const msg = imageFile && imageFile.error ? imageFile.error : 'Unknown conversion error';
            return setStatusText('Error: Failed to convert PDF to image: ' + msg);
        }
            
            setStatusText('Uploading the image...');
            const uploadedImage = await fs.upload([imageFile.file]);
            if(!uploadedImage) return setStatusText('Error: Failed to uploading image');

            setStatusText('preparing data...');

            const uuid = generateUUID();
            const data = {
                id: uuid,
                resumePath: uploadedFile.path,
                imagePath: uploadedImage.path,
                companyName, jobTitle, jobDescription,
                feedback: '',
            }
            await kv.set( `resume:${uuid}`, JSON.stringify(data));

            setStatusText('Analysing...');

            const feedback = await ai.feedback(
                uploadedFile.path,
                prepareInstructions({ jobTitle, jobDescription })
            )
            if (!feedback) return setStatusText('Error: Failed to analyze resume');

            const feedbackText = typeof feedback.message.content === 'string'
                ? feedback.message.content
                : feedback.message.content[0].text;

            data.feedback = JSON.parse(feedbackText);
            await kv.set(`resume:${uuid}`, JSON.stringify(data));
            setStatusText('Analysis complete, redirecting...');
            console.log(data);
            navigate(`/resume/${uuid}`);
        }

    const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const form = e.currentTarget.closest('form');
        if(!form) return;
        const formData = new FormData(form);

        const companyName  = formData.get('company-name') as string;
        const jobTitle = formData.get('job-title') as string;
        const jobDescription = formData.get('job-description') as string;

        if(!file) return;

        handleAnalyze({ companyName, jobTitle, jobDescription, file });

    }

    return (
        <main className="bg-[url('/images/bg-main.svg')] bg-cover">
            <Navbar />

            <section className="main-section">
                <div className="page_heading py-16">
                    <h1>Smart feedback for your dream job</h1>
                    {isProcessing ? (
                        <>
                            <h2>{statusText}</h2>
                            <img src="/images/resume-scan.gif" className="w-full" />
                        </>
                    ) : (
                        <h2>Drop your resume for an ATS score and improvement tips</h2>
                    )}
                    {!isProcessing && (
                        <form id="upload-form" onSubmit={handleSubmit} className="flex flex-col gap-4 mt-8">
                            <div className="form-div">
                                <label htmlFor="company-name">Company Name</label>
                                <input type="text" name="company-name" placeholder="Company Name" id="company-name"/>

                            </div> 
                            <div className="form-div">
                                <label htmlFor="job-title">Job Title</label>
                                <input type="text" name="job-title" placeholder="Job Title" id="job-title"/>

                            </div>
                            <div className="form-div">
                                <label htmlFor="job-description">Job Description</label>
                                <textarea rows={5} name="job-description" placeholder="Job Description" id="job-description"/>

                            </div>
                            <div className="form-div">
                                <label htmlFor="uploader">Upload Resume</label>
                                <FileUploader onFileSelect={handleFileSelect}/>

                                {file && (
                                    <div className="mt-2 flex items-center justify-between">
                                        <p className="text-sm text-gray-700 truncate max-w-xs">
                                            Selected file: <span className="font-medium">{file.name}</span>
                                            <span className="text-xs text-gray-500"> — {formatSize(file.size)}</span>
                                        </p>
                                        <button type="button" className="text-sm text-red-600 ml-4" onClick={() => setFile(null)}>
                                            Remove
                                        </button>
                                    </div>
                                )}

                                {/* Announce selection changes for screen readers */}
                                <div aria-live="polite" className="sr-only">
                                    {file ? `Selected file ${file.name}` : 'No file selected'}
                                </div>
                            </div>

                            <button className="primary-button" type="submit" disabled={!file}>
                                {file ? 'Analyze Resume' : 'Select a resume to analyze'}
                            </button>
                        </form>
                    )}
                </div>

            </section>
        </main>
    )
}
export default Upload