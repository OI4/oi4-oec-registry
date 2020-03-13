export class CommonFetch {
  constructor(mode = 'fetch', address, port) {
    this.mode = mode;
    this.http = null;
    this.address = address;
    this.port = port;
    this.httpPrefix = 'http';
    if (mode === 'cockpit') {
      console.log('Cockpit selected');
      const cockpitEndpoint = {
        address: this.address,
        port: parseInt(this.port, 10),
      };
      this.http = cockpit.http(cockpitEndpoint); // eslint-disable-line no-undef
      this.http.get('/health')
      .then(resp => {
        console.log(resp.text());
        console.log('Http works fine, continuing without tls');
        this.httpPrefix = 'http';
      })
      .catch(e => {
        console.log(e);
        if (e.message === 'protocol-error') { // If it does not work, try it with https
          const cockpitEndPointHttps = {
            address: this.address,
            port: parseInt(this.port, 10),
            tls: {
              validate: false,
            }
          };
          this.http = cockpit.http(cockpitEndPointHttps); // eslint-disable-line no-undef
          this.http.get('/health')
          .then(resp => {
            console.log(resp);
            console.log('No errors with https, continuing with https');
            this.httpPrefix = 'https';
          })
          .catch(e => {
            console.log(e);
            console.log('Still erroring with https');
          });
        }
      });
    } else if (mode === 'fetch') {
      console.log('Fetch selected');
      fetch(`http://${this.address}:${this.port}/health`, { // Try to get a simple health resource via HTTP
        method: 'GET',
        headers: {
          'Content-Type': 'text/plain',
        },
      })
        .then(resp => {
          console.log(resp.text());
          this.httpPrefix = 'http'; // Http worked, this means the server works with http
        })
        .catch(e => { // If it does not work, try it with https
          if (e instanceof TypeError) {
            fetch(`https://${this.address}:${this.port}/health`, {
              method: 'GET',
              headers: {
                'Content-Type': 'text/plain',
              },
            })
              .then(resp => {
                console.log(resp.text());
                this.httpPrefix = 'https'; // HTTPS worked, we can set the prefix to https
              })
              .catch(e => { // If it still doesn't work, we just print the error message...
                console.log(e);
              });
          }
        });
    } else {
      console.log('Error: No match selected');
    }
  }

  get(url) {
    if (this.mode === 'fetch') {
      return new Promise((resolve, reject) => {
        fetch(`${this.httpPrefix}://${this.address}:${this.port}${url}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'text/plain',
          },
        })
          .then(resp => {
            resolve(resp.text());
          });
      });
    } else if (this.mode === 'cockpit') {
      return this.http.get(url);
    }
  }

  delete(url) {
    if (this.mode === 'fetch') {
      return new Promise((resolve, reject) => {
        fetch(`${this.httpPrefix}://${this.address}:${this.port}${url}`, {
          method: 'DELETE',
        })
          .then(resp => {
            resolve(resp.text());
          });
      });
    } else if (this.mode === 'cockpit') {
      return this.http.request({
        body: '',
        method: 'DELETE',
        path: url,
      });
    }
  }

  put(url, body) {
    if (this.mode === 'fetch') {
      return new Promise((resolve, reject) => {
        fetch(`${this.httpPrefix}://${this.address}:${this.port}${url}`, {
          method: 'PUT',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
          },
          body: body,
        })
          .then(resp => {
            resolve(resp.text());
          });
      });
    } else if (this.mode === 'cockpit') {
      return this.http.request({
        body: body,
        method: 'PUT',
        path: url,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
      });
    }
  }
}
