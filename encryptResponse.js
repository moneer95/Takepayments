export function encryptResponse(responseFields) {
    // Create the data to encrypt
    const dataToEncrypt = {
        status: 'success',
        transactionId: responseFields.transactionUnique || '',
        amount: paymentData.amount || '',
        customerEmail: paymentData.customerEmail || '',
        customerName: paymentData.customerName || '',
        timestamp: Date.now()
    };
    
    // Encrypt using AES-256-CBC
    const algorithm = 'aes-256-cbc';
    const secretKey = process.env.PAYMENT_ENCRYPTION_KEY || 'your-32-character-secret-key-here';
    const iv = crypto.randomBytes(16);
    
    // Ensure secret key is 32 bytes for AES-256
    const key = crypto.scryptSync(secretKey, 'salt', 32);
    
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(JSON.stringify(dataToEncrypt), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Return base64 encoded encrypted data with IV
    return Buffer.from(iv.toString('hex') + ':' + encrypted).toString('base64');
}
