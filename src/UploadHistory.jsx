import { useEffect, useState } from 'react';

export default function UploadHistory() {
    const [uploads, setUploads] = useState([]);

    useEffect(() => {
        fetch('/api/uploads')
            .then(res => res.json())
            .then(setUploads)
            .catch(console.error);
    }, []);

    return (
        <div className="upload-history">
            <h2>📜 Upload History</h2>

            <table>
                <thead>
                    <tr>
                        <th>Status</th>
                        <th>Title</th>
                        <th>Playlist</th>
                        <th>Channel</th>
                    </tr>
                </thead>

                <tbody>
                    {uploads.map(upload => (
                        <tr key={upload.id}>
                            <td>
                                {upload.status === 'completed'
                                    ? '✅'
                                    : '❌'}
                            </td>

                            <td>{upload.title}</td>
                            <td>{upload.playlistTitle}</td>
                            <td>{upload.channelName}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}