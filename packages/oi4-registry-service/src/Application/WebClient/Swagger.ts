import express = require('express');
import swaggerUi from "swagger-ui-express";


export class Swagger
{
    private readonly _client: express.Application;

    constructor(client: express.Application) {
        this._client = client;
    }

    public initSwagger(): void {
        this._client.use(express.static('public'));
        const options = {
            swaggerOptions: {
                url: '/api/openapi.json',
            },
            customCss: '.swagger-ui .topbar { display: none }'
        };

        this._client.use('/api', swaggerUi.serveFiles(null, options), swaggerUi.setup(null, options));
    }
}