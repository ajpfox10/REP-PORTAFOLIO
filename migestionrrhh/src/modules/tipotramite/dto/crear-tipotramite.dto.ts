// src/modules/tipotramite/dto/crear-tipotramite.dto.ts

export class CrearTipoTramiteDto {
    readonly TIPODETRAMITE!: string;
    readonly fechaDeAlta?: Date;
    readonly usuarioCarga!: string;
}
