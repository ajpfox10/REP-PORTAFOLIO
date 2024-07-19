document.addEventListener("DOMContentLoaded", function () {
    var footer = `
        <footer>
            <div class="footer-content-how-to-get">
                <div class="social-icons-how-to-get">
                    <a href="https://wa.me/1234567890" target="_blank" class="whatsapp">
                        <i class="lab la-whatsapp footer-icon-how-to-get"></i>
                    </a>
                    <a href="https://www.facebook.com" target="_blank" class="facebook">
                        <i class="lab la-facebook footer-icon-how-to-get"></i>
                    </a>
                    <a href="https://www.instagram.com" target="_blank" class="instagram">
                        <i class="lab la-instagram footer-icon-how-to-get"></i>
                    </a>
                    <a href="https://www.twitter.com" target="_blank" class="twitter">
                        <i class="lab la-twitter footer-icon-how-to-get"></i>
                    </a>
                </div>
                <button class="back-btn-how-to-get" onclick="window.location.href='../index.html'">Volver a la página principal</button>
            </div>
        </footer>
    `;
    document.body.insertAdjacentHTML('beforeend', footer);
});
