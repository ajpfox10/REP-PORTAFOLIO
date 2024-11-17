using Microsoft.AspNetCore.Mvc;
using NTwain;
using NTwain.Data; // Esto es esencial para TWIdentity
using System.Collections.Generic;
using System;

namespace WebApplication1.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class ScannerController : ControllerBase
    {
        private TwainSession _twainSession;

        public ScannerController()
        {
            try
            {
                var appId = new TWIdentity
                {
                    ProductName = "MyScannerApp",
                    Manufacturer = "MyCompany",
                    ProtocolMajor = TWProtocol.Major,
                    ProtocolMinor = TWProtocol.Minor,
                    Version = new TWVersion
                    {
                        MajorNum = 1,
                        MinorNum = 0,
                        Language = TWLanguage.USA,
                        Country = TWCountry.USA,
                        Info = "Demo Version"
                    }
                };

                _twainSession = new TwainSession(appId);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error al inicializar TWAIN: {ex.Message}");
            }
        }
    }
}
