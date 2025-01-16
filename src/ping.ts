const axiosConnection = require("axios");
const PING_URL = 'https://alertsockets.onrender.com/';
const PING_INTERVAL = 10 * 60 * 1000; // 10 minutes in milliseconds

const pingServer = async (): Promise<void> => {
  try {
    const response = await axiosConnection.get(PING_URL);
    console.log(`Ping successful: ${response.status} ${response.statusText}`);
  } catch (error: any) {
    if (axiosConnection.isAxiosError(error)) {
      console.error('Ping failed (AxiosError):', error.message);
    } else {
      console.error('Ping failed (Unknown Error):', error);
    }
  }
};

// Initial ping
pingServer().then(() => {
  console.log("Initial ping completed.");
});

// Start pinging at regular intervals
setInterval(pingServer, PING_INTERVAL);
