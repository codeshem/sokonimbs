const axios = require('axios');

class LipiaAPI {
  constructor() {
    this.apiKey = process.env.LIPIA_API_KEY;
    this.baseURL = 'https://lipia-api.kreativelabske.com/api';
    
    if (!this.apiKey) {
      console.warn('Lipia API key not configured. Payment functionality will not work.');
      this.demoMode = true;
    } else {
      console.log('Lipia API initialized with key:', this.apiKey.substring(0, 8) + '...');
      this.demoMode = false;
    }
  }

  /**
   * Initiate STK Push payment using Lipia API
   * @param {Object} params - Payment parameters
   * @param {string} params.amount - Amount to charge
   * @param {string} params.phoneNumber - Phone number (07XXXXXXXX format)
   * @param {string} params.accountReference - Account reference
   * @param {string} params.transactionDesc - Transaction description
   * @returns {Promise<Object>} API response
   */
  async stkPush({ amount, phoneNumber, accountReference, transactionDesc }) {
    try {
      if (this.demoMode) {
        console.log('Demo mode: Simulating Lipia STK Push success');
        return {
          success: true,
          message: 'Payment request sent successfully (Demo Mode)',
          reference: `DEMO_${Date.now()}`,
          phone: phoneNumber,
          amount: amount
        };
      }

      // Format phone number to 07XXXXXXXX format
      const formattedPhone = this.formatPhoneNumber(phoneNumber);

      const payload = {
        phone: formattedPhone,
        amount: Math.round(parseFloat(amount)).toString()
      };

      console.log('Lipia STK Push Request:', payload);

      const response = await axios.post(`${this.baseURL}/request/stk`, payload, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      console.log('Lipia STK Push Response:', response.data);
      return response.data;

    } catch (error) {
      console.error('Lipia STK Push Error:', error.response?.data || error.message);
      
      if (error.response) {
        return {
          success: false,
          message: error.response.data?.message || 'Request failed',
          error: error.response.data
        };
      } else {
        return {
          success: false,
          message: 'Network error or timeout',
          error: error.message
        };
      }
    }
  }

  /**
   * Format phone number to Lipia format (07XXXXXXXX)
   * @param {string} phone - Phone number in various formats
   * @returns {string} Formatted phone number
   */
  formatPhoneNumber(phone) {
    // Remove all non-digit characters
    let cleaned = phone.replace(/[^\d]/g, '');
    
    // Handle different formats
    if (cleaned.startsWith('254')) {
      // Convert 254XXXXXXXXX to 07XXXXXXXX
      cleaned = '0' + cleaned.slice(3);
    } else if (cleaned.startsWith('7') && cleaned.length === 9) {
      // Convert 7XXXXXXXX to 07XXXXXXXX
      cleaned = '0' + cleaned;
    } else if (cleaned.startsWith('1') && cleaned.length === 9) {
      // Convert 1XXXXXXXX to 01XXXXXXXX
      cleaned = '0' + cleaned;
    } else if (!cleaned.startsWith('0')) {
      // Assume it needs 0 prefix
      cleaned = '0' + cleaned;
    }

    return cleaned;
  }

  /**
   * Validate phone number format for Lipia API
   * @param {string} phone - Phone number to validate
   * @returns {boolean} True if valid
   */
  isValidPhoneNumber(phone) {
    const formatted = this.formatPhoneNumber(phone);
    // Kenyan mobile numbers: 07XXXXXXXX or 01XXXXXXXX
    return /^0[71]\d{8}$/.test(formatted);
  }
}

module.exports = LipiaAPI;